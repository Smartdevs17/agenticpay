// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Batch splitter
/// @notice Execute multiple direct transfers in one transaction. Amortises
///         the base transaction cost (~21,000 gas) across N payouts and
///         avoids the call-data cost of re-encoding the same
///         `to`/`amount` tuple for each external call.
/// @dev Pure router — no storage, no admin, no fees. Callers authorise
///      value up-front via `msg.value`.
contract BatchSplitter {
    struct Transfer {
        address to;
        uint256 amount;
    }

    event BatchExecuted(address indexed sender, uint256 totalTransferred, uint256 count);

    error ZeroRecipient();
    error ValueMismatch(uint256 expected, uint256 provided);
    error TransferFailed(address to, uint256 amount);

    function batchTransfer(Transfer[] calldata transfers) external payable {
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
