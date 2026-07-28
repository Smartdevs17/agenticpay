// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AgenticPay Payment Request with Expiration — Issue #460
/// @notice Creates time-bound payment requests enforced on-chain.
///         Any payment attempted after `expiresAt + gracePeriod` is reverted.
/// @dev Uses block.timestamp. Grace period mitigates minor miner manipulation.
contract PaymentRequestExpiry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    enum RequestStatus { Pending, Paid, Expired, Cancelled }

    struct PaymentRequest {
        uint256 id;
        address requester;
        address payer;         // address(0) = open (anyone may pay)
        address token;         // address(0) = native ETH
        uint256 amount;
        RequestStatus status;
        uint256 createdAt;
        uint256 expiresAt;
        uint32  gracePeriod;   // seconds of extra leniency
        uint256 expiredAt;     // 0 until expired
        uint256 paidAt;        // 0 until paid
        string  memo;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 private _nextId;
    mapping(uint256 => PaymentRequest) private _requests;

    /// Default grace period — absorbs ±15 s block timestamp variance.
    uint32 public defaultGracePeriod = 60;
    /// Maximum TTL for any request: 90 days.
    uint256 public constant MAX_TTL = 90 days;
    /// Minimum TTL: 60 seconds.
    uint256 public constant MIN_TTL = 60 seconds;

    // ─── Events ───────────────────────────────────────────────────────────────

    event RequestCreated(
        uint256 indexed id,
        address indexed requester,
        address indexed payer,
        address token,
        uint256 amount,
        uint256 expiresAt,
        string  memo
    );
    event RequestPaid(
        uint256 indexed id,
        address indexed requester,
        address indexed payer,
        uint256 amount,
        uint256 paidAt
    );
    event RequestExpired(uint256 indexed id, address indexed requester, uint256 expiredAt);
    event RequestCancelled(uint256 indexed id, address indexed requester);
    event RequestRenewed(uint256 indexed oldId, uint256 indexed newId, uint256 newAmount, uint256 newExpiresAt);
    event DefaultGracePeriodUpdated(uint32 newGracePeriod);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error RequestNotFound(uint256 id);
    error RequestAlreadyPaid(uint256 id);
    error RequestAlreadyExpired(uint256 id);
    error RequestAlreadyCancelled(uint256 id);
    error RequestNotExpiredYet(uint256 id);
    error RequestIsExpired(uint256 id);
    error UnauthorizedPayer(uint256 id, address caller);
    error InvalidAmount();
    error InvalidTtl(uint256 ttl);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Core functions ───────────────────────────────────────────────────────

    /// @notice Create a time-bound payment request.
    /// @param payer      Specific payer address, or address(0) for open requests.
    /// @param token      ERC-20 token address, or address(0) for native ETH.
    /// @param amount     Payment amount in token units (or wei for ETH).
    /// @param ttlSeconds Time-to-live in seconds from now (60 s – 90 days).
    /// @param memo       Optional human-readable note.
    function createRequest(
        address payer,
        address token,
        uint256 amount,
        uint256 ttlSeconds,
        string calldata memo
    ) external returns (uint256 id) {
        if (amount == 0) revert InvalidAmount();
        if (ttlSeconds < MIN_TTL || ttlSeconds > MAX_TTL) revert InvalidTtl(ttlSeconds);

        id = ++_nextId;
        uint256 expiresAt = block.timestamp + ttlSeconds;

        _requests[id] = PaymentRequest({
            id:          id,
            requester:   msg.sender,
            payer:       payer,
            token:       token,
            amount:      amount,
            status:      RequestStatus.Pending,
            createdAt:   block.timestamp,
            expiresAt:   expiresAt,
            gracePeriod: defaultGracePeriod,
            expiredAt:   0,
            paidAt:      0,
            memo:        memo
        });

        emit RequestCreated(id, msg.sender, payer, token, amount, expiresAt, memo);
    }

    /// @notice Pay a pending request. Enforces expiration on-chain.
    /// @dev For ERC-20 tokens the caller must pre-approve this contract.
    ///      For ETH requests, msg.value must equal the request amount exactly.
    function pay(uint256 id) external payable nonReentrant {
        PaymentRequest storage req = _getActive(id);

        // ── Expiration check ──────────────────────────────────────────────────
        if (block.timestamp > req.expiresAt + req.gracePeriod) {
            // Lazily mark expired on first payment attempt after deadline.
            req.status    = RequestStatus.Expired;
            req.expiredAt = block.timestamp;
            emit RequestExpired(id, req.requester, block.timestamp);
            revert RequestIsExpired(id);
        }

        // ── Payer check ───────────────────────────────────────────────────────
        if (req.payer != address(0) && req.payer != msg.sender) {
            revert UnauthorizedPayer(id, msg.sender);
        }

        address _requester = req.requester;
        uint256 _amount    = req.amount;
        address _token     = req.token;

        req.status = RequestStatus.Paid;
        req.paidAt = block.timestamp;

        // ── Transfer ──────────────────────────────────────────────────────────
        if (_token == address(0)) {
            // Native ETH
            require(msg.value == _amount, "PaymentRequestExpiry: wrong ETH amount");
            (bool ok, ) = _requester.call{value: _amount}("");
            require(ok, "PaymentRequestExpiry: ETH transfer failed");
        } else {
            require(msg.value == 0, "PaymentRequestExpiry: ETH sent for token request");
            IERC20(_token).safeTransferFrom(msg.sender, _requester, _amount);
        }

        emit RequestPaid(id, _requester, msg.sender, _amount, block.timestamp);
    }

    /// @notice Expire a request that is past its deadline + grace period.
    ///         Anyone may call this to sweep stale requests.
    function expireRequest(uint256 id) external {
        PaymentRequest storage req = _requests[id];
        if (req.id == 0) revert RequestNotFound(id);
        if (req.status == RequestStatus.Paid)      revert RequestAlreadyPaid(id);
        if (req.status == RequestStatus.Cancelled) revert RequestAlreadyCancelled(id);
        if (req.status == RequestStatus.Expired)   revert RequestAlreadyExpired(id);
        if (block.timestamp <= req.expiresAt + req.gracePeriod) revert RequestNotExpiredYet(id);

        req.status    = RequestStatus.Expired;
        req.expiredAt = block.timestamp;
        emit RequestExpired(id, req.requester, block.timestamp);
    }

    /// @notice Cancel a pending request. Only the requester may cancel.
    function cancelRequest(uint256 id) external {
        PaymentRequest storage req = _getActive(id);
        require(msg.sender == req.requester, "PaymentRequestExpiry: not requester");
        req.status = RequestStatus.Cancelled;
        emit RequestCancelled(id, req.requester);
    }

    /// @notice Renew an expired or cancelled request with a new amount and TTL.
    ///         Creates a brand-new request linked by event to the original.
    function renewRequest(
        uint256 oldId,
        uint256 newAmount,
        uint256 newTtlSeconds
    ) external returns (uint256 newId) {
        PaymentRequest storage old = _requests[oldId];
        if (old.id == 0) revert RequestNotFound(oldId);
        require(
            old.status == RequestStatus.Expired || old.status == RequestStatus.Cancelled,
            "PaymentRequestExpiry: original not expired/cancelled"
        );
        require(msg.sender == old.requester, "PaymentRequestExpiry: not requester");
        if (newAmount == 0) revert InvalidAmount();
        if (newTtlSeconds < MIN_TTL || newTtlSeconds > MAX_TTL) revert InvalidTtl(newTtlSeconds);

        newId = ++_nextId;
        uint256 newExpiresAt = block.timestamp + newTtlSeconds;

        _requests[newId] = PaymentRequest({
            id:          newId,
            requester:   old.requester,
            payer:       old.payer,
            token:       old.token,
            amount:      newAmount,
            status:      RequestStatus.Pending,
            createdAt:   block.timestamp,
            expiresAt:   newExpiresAt,
            gracePeriod: defaultGracePeriod,
            expiredAt:   0,
            paidAt:      0,
            memo:        old.memo
        });

        emit RequestRenewed(oldId, newId, newAmount, newExpiresAt);
        emit RequestCreated(newId, old.requester, old.payer, old.token, newAmount, newExpiresAt, old.memo);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setDefaultGracePeriod(uint32 gracePeriod) external onlyOwner {
        defaultGracePeriod = gracePeriod;
        emit DefaultGracePeriodUpdated(gracePeriod);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getRequest(uint256 id) external view returns (PaymentRequest memory) {
        if (_requests[id].id == 0) revert RequestNotFound(id);
        return _requests[id];
    }

    function isExpired(uint256 id) external view returns (bool) {
        PaymentRequest storage req = _requests[id];
        if (req.id == 0) return false;
        if (req.status == RequestStatus.Expired) return true;
        return block.timestamp > req.expiresAt + req.gracePeriod;
    }

    function nextRequestId() external view returns (uint256) {
        return _nextId + 1;
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    function _getActive(uint256 id) internal view returns (PaymentRequest storage req) {
        req = _requests[id];
        if (req.id == 0)                           revert RequestNotFound(id);
        if (req.status == RequestStatus.Paid)      revert RequestAlreadyPaid(id);
        if (req.status == RequestStatus.Expired)   revert RequestAlreadyExpired(id);
        if (req.status == RequestStatus.Cancelled) revert RequestAlreadyCancelled(id);
    }
}
