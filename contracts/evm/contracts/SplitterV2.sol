// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SplitterV1} from "./SplitterV1.sol";

/// @title AgenticPay Splitter (V2, UUPS-upgradeable)
/// @notice Adds a pause switch on top of V1 without changing the V1 storage
///         layout. Demonstrates the upgrade path and is exercised by the
///         integration tests under `test/Upgrade.test.ts`.
contract SplitterV2 is SplitterV1 {
    /// @dev New storage slot must come after the V1 fields. The V1 `__gap`
    ///      (48 slots) is intentionally consumed one slot at a time as
    ///      future versions add state.
    bool public paused;

    event Paused(bool isPaused);

    error ContractPaused();

    /// @notice One-time migration hook. Re-running this on an already-upgraded
    ///         proxy is blocked by `reinitializer(2)`; subsequent upgrades
    ///         should bump the version accordingly. This function does NOT
    ///         re-call the parent initialisers — they were already run by
    ///         V1's `initialize` before this upgrade.
    /// @custom:oz-upgrades-validate-as-initializer
    /// @custom:oz-upgrades-unsafe-allow missing-initializer-call
    function initializeV2() external reinitializer(2) {
        paused = false;
        emit Paused(false);
    }

    function setPaused(bool isPaused) external onlyOwner {
        paused = isPaused;
        emit Paused(isPaused);
    }

    /// @notice Same behaviour as V1's `splitPayment`, but reverts when the
    ///         contract is paused. External callers see the same selector
    ///         because the override preserves the function signature.
    function splitPayment() external payable override nonReentrant {
        if (paused) revert ContractPaused();
        _splitPayment();
    }

    function version() external pure virtual override returns (string memory) {
        return "2.0.0";
    }
}
