// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Batch splitter
/// @notice Execute multiple direct transfers in one transaction. Amortises
///         the base transaction cost (~21,000 gas) across N payouts and
///         avoids the call-data cost of re-encoding the same
///         `to`/`amount` tuple for each external call.
/// @dev Pure router — no storage, no admin, no fees. Callers authorise
///      value up-front via `msg.value`.
///
///      Security: a one-byte reentrancy latch (`_locked`) guards
///      `batchTransfer`. Without it a malicious recipient could re-enter
///      the function mid-loop and drain more ETH than was authorised.
///      The latch is cheaper than OZ's uint256 status slot under Cancun.
contract BatchSplitter {
    struct Transfer {
        address to;
        uint256 amount;
    }

    /// @dev One-byte reentrancy latch: 0 = unlocked, 1 = locked.
    uint8 private _locked;

    event BatchExecuted(address indexed sender, uint256 totalTransferred, uint256 count);

    error ZeroRecipient();
    error ValueMismatch(uint256 expected, uint256 provided);
    error TransferFailed(address to, uint256 amount);
    /// @dev Emitted (as a revert) when a reentrant call is detected.
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    /// @notice Distribute `msg.value` to each recipient in `transfers`.
    /// @dev Checks-effects-interactions pattern:
    ///      1. CHECK  — verify msg.value equals the declared total.
    ///      2. EFFECT — the nonReentrant latch is set before any `.call`.
    ///      3. INTERACT — individual `.call{value}` transfers.
    ///      The latch prevents direct reentrancy, cross-function reentrancy
    ///      (there are no other mutative functions here), and read-only
    ///      reentrancy (the latch is a storage write, not a view).
    function batchTransfer(Transfer[] calldata transfers) external payable nonReentrant {
        uint256 len = transfers.length;
        uint256 running;

        // Sum first so we can fail fast if msg.value doesn't match —
        // otherwise we'd refund mid-loop which wastes gas.
        for (uint256 i; i < len; ) {
            running += transfers[i].amount;
            unchecked { ++i; }
        }
        if (running != msg.value) revert ValueMismatch(running, msg.value);

        for (uint256 i; i < len; ) {
            Transfer calldata t = transfers[i];
            if (t.to == address(0)) revert ZeroRecipient();
            (bool ok, ) = t.to.call{value: t.amount}("");
            if (!ok) revert TransferFailed(t.to, t.amount);
            unchecked { ++i; }
        }

        emit BatchExecuted(msg.sender, running, len);
    }
}
