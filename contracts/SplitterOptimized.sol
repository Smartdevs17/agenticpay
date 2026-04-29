// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgenticPay Splitter (gas-optimized reference)
/// @notice Drop-in replacement for `Splitter.sol` with aggressive gas
///         tuning. Interfaces and events are deliberately compatible so
///         off-chain consumers don't need to change.
/// @dev Optimisations applied (see contracts/gas-analysis.md for measured
///      savings):
///        - Struct packing: `Recipient` fits `wallet` + `bps` + `active`
///          into a single 32-byte slot (20+2+1 bytes), then `minThreshold`
///          takes its own slot.
///        - Custom errors instead of `require(msg)` strings — saves the
///          calldata and runtime cost of the revert-string bytes.
///        - Unchecked loop increment (`++i` inside an `unchecked` block)
///          avoids the overflow guard Solidity 0.8+ inserts.
///        - Cached `recipients.length` to avoid the SLOAD-per-iteration.
///        - `immutable MAX_BPS` puts the constant in code rather than
///          storage, eliminating one SLOAD per validation.
///        - Assembly-free low-level `call{value: x}("")` — the standard
///          pattern but with the return tuple collapsed to one local.
///        - Reentrancy guard flips a single byte slot (`_locked`), which
///          is much cheaper than OZ's `_status` u256 flip under Cancun.
contract SplitterOptimized {
    // -------- packed storage --------

    struct Recipient {
        address wallet;    // 20 bytes — slot 0 low
        uint16 bps;        //  2 bytes — slot 0 offset 20
        bool active;       //  1 byte  — slot 0 offset 22
        // 9 bytes of slack left in slot 0.
        uint256 minThreshold; // slot 1
    }

    uint16 public platformFeeBps;
    /// @dev One-byte reentrancy latch (0 = unlocked, 1 = locked).
    uint8 private _locked;
    address public owner;
    // `platformFeeBps` (2) + `_locked` (1) + `owner` (20) = 23 bytes; the
    // rest of the slot is padding the compiler must reserve but costs
    // nothing at access time.

    Recipient[] public recipients;

    // -------- events (identical to legacy) --------

    event RecipientConfigured(
        uint256 indexed index,
        address wallet,
        uint16 bps,
        uint256 minThreshold,
        bool active
    );
    event PlatformFeeUpdated(uint16 feeBps);
    event PaymentSplit(uint256 totalAmount, uint256 platformFee, uint256 distributedAmount);

    // -------- errors --------

    error NotOwner();
    error InvalidFee(uint16 bps);
    error InvalidRecipient();
    error InvalidIndex(uint256 index);
    error NoPayment();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed(address to, uint256 amount);
    error Reentrancy();

    // -------- immutables --------

    uint16 private constant MAX_BPS = 10_000;

    // -------- modifiers --------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    // -------- constructor --------

    constructor(uint16 initialPlatformFeeBps) {
        if (initialPlatformFeeBps > MAX_BPS) revert InvalidFee(initialPlatformFeeBps);
        owner = msg.sender;
        platformFeeBps = initialPlatformFeeBps;
        emit PlatformFeeUpdated(initialPlatformFeeBps);
    }

    // -------- admin --------

    function setPlatformFeeBps(uint16 feeBps) external onlyOwner {
        if (feeBps > MAX_BPS) revert InvalidFee(feeBps);
        platformFeeBps = feeBps;
        emit PlatformFeeUpdated(feeBps);
    }

    function setRecipient(
        uint256 index,
        address wallet,
        uint16 bps,
        uint256 minThreshold,
        bool active
    ) external onlyOwner {
        if (wallet == address(0)) revert InvalidRecipient();
        if (bps > MAX_BPS) revert InvalidFee(bps);

        uint256 len = recipients.length;
        Recipient memory next = Recipient({
            wallet: wallet,
            bps: bps,
            active: active,
            minThreshold: minThreshold
        });
        if (index < len) {
            recipients[index] = next;
        } else if (index == len) {
            recipients.push(next);
        } else {
            revert InvalidIndex(index);
        }

        emit RecipientConfigured(index, wallet, bps, minThreshold, active);
    }

    function recipientsCount() external view returns (uint256) {
        return recipients.length;
    }

    // -------- core split --------

    function splitPayment() external payable nonReentrant {
        if (msg.value == 0) revert NoPayment();

        uint16 feeBps = platformFeeBps;
        // Cache once to save N*SLOAD; the compiler still folds constants.
        uint256 platformFee = (msg.value * feeBps) / MAX_BPS;
        uint256 distributable = msg.value - platformFee;
        uint256 distributed;

        uint256 len = recipients.length;
        for (uint256 i; i < len; ) {
            Recipient memory r = recipients[i];
            if (r.active && r.bps != 0) {
                uint256 amount = (distributable * r.bps) / MAX_BPS;
                if (amount >= r.minThreshold) {
                    distributed += amount;
                    (bool ok, ) = r.wallet.call{value: amount}("");
                    if (!ok) revert TransferFailed(r.wallet, amount);
                }
            }
            unchecked { ++i; }
        }

        emit PaymentSplit(msg.value, platformFee, distributed);
    }

    // -------- withdraw --------

    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        uint256 available = address(this).balance;
        if (amount > available) revert InsufficientBalance(amount, available);

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }

    receive() external payable {}
}
