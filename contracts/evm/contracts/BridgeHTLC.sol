// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BridgeHTLC
/// @notice HTLC + optimistic dispute bridge for native ETH and ERC-20 cross-chain transfers.
/// @dev Supports Stellar→EVM (via oracle relay attestation) and EVM→Stellar directions.
///      Set `token` to address(0) in TokenLock for native ETH; any IERC20 otherwise.
contract BridgeHTLC is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Lock {
        address sender;
        address recipient;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool claimed;
        bool refunded;
        uint256 disputeDeadline;
    }

    /// @notice Extended lock that also tracks an ERC-20 token address and Stellar origin tx.
    struct TokenLock {
        address sender;
        address recipient;
        address token;        // address(0) = native ETH
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool claimed;
        bool refunded;
        uint256 disputeDeadline;
        bytes32 stellarOriginHash; // keccak256 of the originating Stellar tx ID (zero if EVM-origin)
    }

    mapping(bytes32 => Lock) public locks;
    mapping(bytes32 => TokenLock) public tokenLocks;

    uint16 public feeBps = 30;
    address public feeCollector;

    /// @notice Trusted oracle relayers permitted to attest Stellar origin transactions.
    mapping(address => bool) public trustedRelayers;

    event Locked(bytes32 indexed lockId, address indexed sender, address indexed recipient, uint256 amount);
    event TokenLocked(bytes32 indexed lockId, address indexed sender, address indexed recipient, address token, uint256 amount, bytes32 stellarOriginHash);
    event Claimed(bytes32 indexed lockId, bytes32 secretHash);
    event Refunded(bytes32 indexed lockId);
    event FeeConfigUpdated(uint16 feeBps, address feeCollector);
    event Disputed(bytes32 indexed lockId, address indexed disputer);
    /// @notice Emitted when a trusted relayer attests the Stellar source transaction.
    event StellarRelayAttested(bytes32 indexed lockId, address indexed relayer, bytes32 stellarOriginHash);
    event RelayerUpdated(address indexed relayer, bool trusted);

    error InvalidFee();
    error InvalidLock();
    error AlreadySettled();
    error InvalidSecret();
    error TimelockNotExpired();
    error DisputeWindowOpen();
    error NotTrustedRelayer();
    error StellarOriginAlreadyAttested();

    constructor(address owner_, address feeCollector_) Ownable(owner_) {
        feeCollector = feeCollector_;
    }

    error TransferToRecipientFailed();
    error TransferFeeFailed();
    error TransferRefundFailed();

    // ── Admin ────────────────────────────────────────────────────────────────

    function setTrustedRelayer(address relayer, bool trusted) external onlyOwner {
        trustedRelayers[relayer] = trusted;
        emit RelayerUpdated(relayer, trusted);
    }

    function setFeeConfig(uint16 nextFeeBps, address nextCollector) external onlyOwner {
        if (nextFeeBps > 1000) revert InvalidFee();
        feeBps = nextFeeBps;
        feeCollector = nextCollector;
        emit FeeConfigUpdated(nextFeeBps, nextCollector);
    }

    function lock(
        bytes32 lockId,
        address recipient,
        bytes32 hashlock,
        uint256 timelock,
        uint256 disputeWindowSeconds
    ) external payable whenNotPaused nonReentrant {
        if (msg.value == 0 || recipient == address(0) || hashlock == bytes32(0) || timelock <= block.timestamp) {
            revert InvalidLock();
        }
        if (locks[lockId].sender != address(0)) revert InvalidLock();

        Lock storage l = locks[lockId];
        l.sender = msg.sender;
        l.recipient = recipient;
        l.amount = msg.value;
        l.hashlock = hashlock;
        l.timelock = timelock;
        unchecked {
            l.disputeDeadline = block.timestamp + disputeWindowSeconds;
        }

        emit Locked(lockId, msg.sender, recipient, msg.value);
    }

    function claim(bytes32 lockId, bytes32 secret) external whenNotPaused nonReentrant {
        Lock storage userLock = locks[lockId];
        if (userLock.sender == address(0)) revert InvalidLock();
        if (userLock.claimed || userLock.refunded) revert AlreadySettled();
        if (keccak256(abi.encodePacked(secret)) != userLock.hashlock) revert InvalidSecret();

        userLock.claimed = true;
        uint256 fee;
        unchecked {
            fee = (userLock.amount * feeBps) / 10_000;
        }
        uint256 payout;
        unchecked {
            payout = userLock.amount - fee;
        }

        (bool okRecipient, ) = userLock.recipient.call{value: payout}("");
        if (!okRecipient) revert TransferToRecipientFailed();
        if (fee > 0 && feeCollector != address(0)) {
            (bool okFee, ) = feeCollector.call{value: fee}("");
            if (!okFee) revert TransferFeeFailed();
        }

        emit Claimed(lockId, keccak256(abi.encodePacked(secret)));
    }

    function refund(bytes32 lockId) external whenNotPaused nonReentrant {
        Lock storage userLock = locks[lockId];
        if (userLock.sender == address(0)) revert InvalidLock();
        if (userLock.claimed || userLock.refunded) revert AlreadySettled();
        if (block.timestamp < userLock.timelock) revert TimelockNotExpired();
        if (block.timestamp < userLock.disputeDeadline) revert DisputeWindowOpen();

        userLock.refunded = true;
        (bool ok, ) = userLock.sender.call{value: userLock.amount}("");
        if (!ok) revert TransferRefundFailed();
        emit Refunded(lockId);
    }

    function dispute(bytes32 lockId) external whenNotPaused {
        Lock storage userLock = locks[lockId];
        if (userLock.sender == address(0)) revert InvalidLock();
        if (userLock.claimed || userLock.refunded) revert AlreadySettled();
        unchecked {
            userLock.disputeDeadline = block.timestamp + 1 days;
        }
        emit Disputed(lockId, msg.sender);
    }

    // ── ERC-20 / Native hybrid HTLC (Stellar↔EVM bridge) ────────────────────

    /// @notice Lock ERC-20 tokens (or native ETH when `token == address(0)`) for cross-chain swap.
    /// @param lockId       Unique identifier for this lock.
    /// @param recipient    Intended beneficiary on this chain.
    /// @param token        ERC-20 contract address; use address(0) for native ETH.
    /// @param amount       Amount of `token` to lock (ignored for native ETH; use msg.value).
    /// @param hashlock     SHA-256 hash of the secret pre-image (keccak256 on EVM side).
    /// @param timelock     Absolute timestamp after which the sender may reclaim funds.
    /// @param disputeWindowSeconds  Seconds after `timelock` during which disputes may be raised.
    /// @param stellarOriginHash  keccak256 of the Stellar tx ID (zero for EVM-initiated swaps).
    function lockToken(
        bytes32 lockId,
        address recipient,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        uint256 disputeWindowSeconds,
        bytes32 stellarOriginHash
    ) external payable whenNotPaused nonReentrant {
        if (recipient == address(0) || hashlock == bytes32(0) || timelock <= block.timestamp) {
            revert InvalidLock();
        }
        if (tokenLocks[lockId].sender != address(0)) revert InvalidLock();

        uint256 lockedAmount;
        if (token == address(0)) {
            if (msg.value == 0) revert InvalidLock();
            lockedAmount = msg.value;
        } else {
            if (amount == 0) revert InvalidLock();
            lockedAmount = amount;
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        TokenLock storage tl = tokenLocks[lockId];
        tl.sender = msg.sender;
        tl.recipient = recipient;
        tl.token = token;
        tl.amount = lockedAmount;
        tl.hashlock = hashlock;
        tl.timelock = timelock;
        tl.stellarOriginHash = stellarOriginHash;
        unchecked {
            tl.disputeDeadline = block.timestamp + disputeWindowSeconds;
        }

        emit TokenLocked(lockId, msg.sender, recipient, token, lockedAmount, stellarOriginHash);
    }

    /// @notice Claim locked tokens by revealing the pre-image `secret`.
    function claimToken(bytes32 lockId, bytes32 secret) external whenNotPaused nonReentrant {
        TokenLock storage tl = tokenLocks[lockId];
        if (tl.sender == address(0)) revert InvalidLock();
        if (tl.claimed || tl.refunded) revert AlreadySettled();
        if (keccak256(abi.encodePacked(secret)) != tl.hashlock) revert InvalidSecret();

        tl.claimed = true;
        uint256 fee;
        unchecked { fee = (tl.amount * feeBps) / 10_000; }
        uint256 payout;
        unchecked { payout = tl.amount - fee; }

        _transferOut(tl.token, tl.recipient, payout);
        if (fee > 0 && feeCollector != address(0)) {
            _transferOut(tl.token, feeCollector, fee);
        }

        emit Claimed(lockId, keccak256(abi.encodePacked(secret)));
    }

    /// @notice Refund the sender after timelock expiry and dispute window.
    function refundToken(bytes32 lockId) external whenNotPaused nonReentrant {
        TokenLock storage tl = tokenLocks[lockId];
        if (tl.sender == address(0)) revert InvalidLock();
        if (tl.claimed || tl.refunded) revert AlreadySettled();
        if (block.timestamp < tl.timelock) revert TimelockNotExpired();
        if (block.timestamp < tl.disputeDeadline) revert DisputeWindowOpen();

        tl.refunded = true;
        _transferOut(tl.token, tl.sender, tl.amount);
        emit Refunded(lockId);
    }

    /// @notice Called by a trusted oracle relayer to record the Stellar origin tx on-chain.
    /// @dev    Useful for audit trails and dispute resolution off-chain indexers.
    function attestStellarOrigin(bytes32 lockId, bytes32 stellarOriginHash) external {
        if (!trustedRelayers[msg.sender]) revert NotTrustedRelayer();
        TokenLock storage tl = tokenLocks[lockId];
        if (tl.sender == address(0)) revert InvalidLock();
        if (tl.stellarOriginHash != bytes32(0)) revert StellarOriginAlreadyAttested();

        tl.stellarOriginHash = stellarOriginHash;
        emit StellarRelayAttested(lockId, msg.sender, stellarOriginHash);
    }

    /// @dev Unified ETH / ERC-20 payout helper.
    function _transferOut(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}('');
            if (!ok) revert TransferToRecipientFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
