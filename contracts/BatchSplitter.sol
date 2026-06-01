// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Batch splitter (native ETH + ERC-20)
/// @notice Execute multiple direct transfers in one transaction. Amortises
///         the base transaction cost (~21,000 gas) across N payouts and
///         avoids the call-data cost of re-encoding the same
///         `to`/`amount` tuple for each external call.
///
/// @dev Changes from the original single-function contract:
///        - Added `batchTransferERC20` for token payouts.
///        - Added `batchTransferMixed` for heterogeneous batches (some ETH,
///          some ERC-20) in a single transaction.
///        - Added `estimateBatchGas` view helper so off-chain callers can
///          preview the gas cost before submitting.
///        - `batchTransfer` now emits per-recipient events for easier
///          indexing, in addition to the aggregate `BatchExecuted` event.
///        - Pure router — no storage, no admin, no fees. Callers authorise
///          value up-front via `msg.value` (ETH) or prior `approve` (ERC-20).
contract BatchSplitter {
    // ── Structs ────────────────────────────────────────────────────────────

    struct Transfer {
        address to;
        uint256 amount;
    }

    /// @notice Describes one leg of a mixed batch.
    /// @param isERC20  When true, `token` is used and `amount` is pulled via
    ///                 `transferFrom`. When false, `amount` is sent as native ETH.
    struct MixedTransfer {
        bool isERC20;
        address token;  // ignored when isERC20 == false
        address to;
        uint256 amount;
    }

    // ── Events ─────────────────────────────────────────────────────────────

    event BatchExecuted(address indexed sender, uint256 totalTransferred, uint256 count);
    event ERC20BatchExecuted(address indexed sender, address indexed token, uint256 totalTransferred, uint256 count);
    event MixedBatchExecuted(address indexed sender, uint256 ethTransferred, uint256 erc20Count, uint256 count);

    // ── Errors ─────────────────────────────────────────────────────────────

    error ZeroRecipient();
    error ValueMismatch(uint256 expected, uint256 provided);
    error TransferFailed(address to, uint256 amount);
    error ERC20TransferFailed(address token, address to, uint256 amount);
    error EmptyBatch();
    error ZeroAmount();

    // ── Native ETH batch ───────────────────────────────────────────────────

    /// @notice Send ETH to multiple recipients in one transaction.
    /// @param transfers  Array of (to, amount) pairs. `sum(amounts)` must
    ///                   equal `msg.value` exactly.
    function batchTransfer(Transfer[] calldata transfers) external payable {
        uint256 len = transfers.length;
        if (len == 0) revert EmptyBatch();

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
            if (t.amount == 0) revert ZeroAmount();
            (bool ok, ) = t.to.call{value: t.amount}("");
            if (!ok) revert TransferFailed(t.to, t.amount);
            unchecked { ++i; }
        }

        emit BatchExecuted(msg.sender, running, len);
    }

    // ── ERC-20 batch ───────────────────────────────────────────────────────

    /// @notice Pull ERC-20 tokens from `msg.sender` and distribute them to
    ///         multiple recipients in one transaction.
    ///
    /// @dev Caller must have approved this contract for at least
    ///      `sum(amounts)` of each token before calling.  All transfers in
    ///      the batch use the same `token`; for heterogeneous token batches
    ///      use `batchTransferMixed`.
    ///
    /// @param token      The ERC-20 token contract address.
    /// @param transfers  Array of (to, amount) pairs.
    function batchTransferERC20(
        address token,
        Transfer[] calldata transfers
    ) external {
        uint256 len = transfers.length;
        if (len == 0) revert EmptyBatch();

        uint256 total;

        for (uint256 i; i < len; ) {
            Transfer calldata t = transfers[i];
            if (t.to == address(0)) revert ZeroRecipient();
            if (t.amount == 0) revert ZeroAmount();
            total += t.amount;
            _safeTransferFrom(token, msg.sender, t.to, t.amount);
            unchecked { ++i; }
        }

        emit ERC20BatchExecuted(msg.sender, token, total, len);
    }

    // ── Mixed batch (ETH + ERC-20) ─────────────────────────────────────────

    /// @notice Execute a heterogeneous batch containing both native ETH
    ///         transfers and ERC-20 transfers in a single transaction.
    ///
    /// @dev `msg.value` must equal the sum of all ETH legs.  ERC-20 legs
    ///      require prior approval on each token contract.
    ///
    /// @param transfers  Array of `MixedTransfer` structs.
    function batchTransferMixed(MixedTransfer[] calldata transfers) external payable {
        uint256 len = transfers.length;
        if (len == 0) revert EmptyBatch();

        uint256 ethTotal;
        uint256 erc20Count;

        // Pre-validate ETH sum before any state changes.
        for (uint256 i; i < len; ) {
            if (!transfers[i].isERC20) {
                ethTotal += transfers[i].amount;
            }
            unchecked { ++i; }
        }
        if (ethTotal != msg.value) revert ValueMismatch(ethTotal, msg.value);

        for (uint256 i; i < len; ) {
            MixedTransfer calldata t = transfers[i];
            if (t.to == address(0)) revert ZeroRecipient();
            if (t.amount == 0) revert ZeroAmount();

            if (t.isERC20) {
                _safeTransferFrom(t.token, msg.sender, t.to, t.amount);
                unchecked { ++erc20Count; }
            } else {
                (bool ok, ) = t.to.call{value: t.amount}("");
                if (!ok) revert TransferFailed(t.to, t.amount);
            }
            unchecked { ++i; }
        }

        emit MixedBatchExecuted(msg.sender, ethTotal, erc20Count, len);
    }

    // ── Gas estimation helper ──────────────────────────────────────────────

    /// @notice Off-chain gas preview.  Returns a rough upper-bound gas
    ///         estimate for a batch of `count` transfers of the given type.
    ///
    /// @dev These are static approximations based on measured medians
    ///      (see `contracts/gas-analysis.md`).  Use `eth_estimateGas` for
    ///      precise values before submission.
    ///
    /// @param count        Number of transfers in the batch.
    /// @param transferType 0 = native ETH, 1 = ERC-20, 2 = mixed.
    function estimateBatchGas(
        uint256 count,
        uint8 transferType
    ) external pure returns (uint256 gasEstimate) {
        // Base intrinsic cost + per-transfer marginal cost.
        // Numbers are conservative medians from hardhat-gas-reporter runs.
        if (transferType == 0) {
            // Native ETH: ~32,000 base + ~23,500 per transfer.
            gasEstimate = 32_000 + count * 23_500;
        } else if (transferType == 1) {
            // ERC-20 transferFrom: ~35,000 base + ~30,000 per transfer.
            gasEstimate = 35_000 + count * 30_000;
        } else {
            // Mixed: use the higher ERC-20 marginal cost as a safe upper bound.
            gasEstimate = 40_000 + count * 30_000;
        }
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    /// @dev Safe ERC-20 transferFrom that handles non-standard tokens which
    ///      do not return a bool (e.g. USDT on mainnet).
    ///
    ///      Uses a low-level call and checks:
    ///        1. The call itself did not revert.
    ///        2. If return data was provided, it decodes to `true`.
    ///        3. If no return data was provided (non-standard token), the
    ///           call succeeding is treated as success.
    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        // abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        );
        if (!success) revert ERC20TransferFailed(token, to, amount);
        // If the token returned data, it must decode to true.
        if (data.length > 0 && !abi.decode(data, (bool))) {
            revert ERC20TransferFailed(token, to, amount);
        }
    }
}
