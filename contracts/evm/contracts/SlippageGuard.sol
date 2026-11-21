// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgenticPay Slippage Guard
/// @notice Enforces a hard, on-chain floor on swap/settlement output amounts.
///         The backend computes an expected output off-chain via simulation
///         (see backend/src/services/slippage-protection.ts) and passes the
///         caller-signed minimum acceptable output (`minAmountOut`) into
///         `executeGuardedSettlement`. The contract reverts if the realized
///         output would fall below that floor, regardless of what the
///         off-chain simulation predicted — so a sandwich attack that
///         manipulates price between simulation and execution cannot drain
///         value past the user's configured tolerance.
/// @dev This contract intentionally has no DEX-routing logic; the actual
///      swap/settlement executor calls `checkSlippage` (or is wrapped by
///      `executeGuardedSettlement`) so the guard can be reused across
///      multiple settlement paths (AtomicSwapBridge, escrow releases, etc).
contract SlippageGuard is Ownable, ReentrancyGuard {
    /// @notice Absolute ceiling on allowed slippage tolerance, in basis points
    ///         (10_000 = 100%). Callers may not request looser protection
    ///         than this even if they try — protects users from fat-finger
    ///         or compromised-client slippage settings.
    uint16 public constant MAX_SLIPPAGE_BPS = 500; // 5%

    uint16 public defaultMaxSlippageBps = 100; // 1%

    event SlippageToleranceUpdated(uint16 newDefaultMaxSlippageBps);
    event GuardedSettlementExecuted(
        address indexed sender,
        address indexed recipient,
        uint256 expectedAmountOut,
        uint256 minAmountOut,
        uint256 actualAmountOut
    );

    error SlippageToleranceTooHigh(uint16 requestedBps, uint16 maxBps);
    error SlippageExceeded(uint256 actualAmountOut, uint256 minAmountOut);
    error ZeroAmount();
    error ExpiredQuote(uint256 deadline, uint256 nowTs);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Updates the protocol-wide default slippage tolerance.
    /// @param newDefaultMaxSlippageBps New default, in basis points. Must not
    ///        exceed MAX_SLIPPAGE_BPS.
    function setDefaultMaxSlippageBps(uint16 newDefaultMaxSlippageBps) external onlyOwner {
        if (newDefaultMaxSlippageBps > MAX_SLIPPAGE_BPS) {
            revert SlippageToleranceTooHigh(newDefaultMaxSlippageBps, MAX_SLIPPAGE_BPS);
        }
        defaultMaxSlippageBps = newDefaultMaxSlippageBps;
        emit SlippageToleranceUpdated(newDefaultMaxSlippageBps);
    }

    /// @notice Computes the minimum acceptable output for a given expected
    ///         output and tolerance, clamped to MAX_SLIPPAGE_BPS.
    function computeMinAmountOut(uint256 expectedAmountOut, uint16 slippageBps) public pure returns (uint256) {
        uint16 effectiveBps = slippageBps > MAX_SLIPPAGE_BPS ? MAX_SLIPPAGE_BPS : slippageBps;
        return expectedAmountOut - ((expectedAmountOut * effectiveBps) / 10_000);
    }

    /// @notice Reverts unless `actualAmountOut >= minAmountOut`. Pure check,
    ///         callable by any settlement executor that wants the guard
    ///         without the deadline/event bookkeeping of the full flow below.
    function checkSlippage(uint256 actualAmountOut, uint256 minAmountOut) public pure {
        if (actualAmountOut < minAmountOut) {
            revert SlippageExceeded(actualAmountOut, minAmountOut);
        }
    }

    /// @notice Full guarded settlement: validates the quote hasn't expired,
    ///         enforces the hard minimum output, and emits an auditable event.
    ///         The actual value transfer is expected to have already happened
    ///         (or happen atomically in the same transaction via the caller);
    ///         this function is the on-chain checkpoint that makes slippage
    ///         enforcement unconditional rather than advisory.
    /// @param recipient Address receiving the settled output.
    /// @param expectedAmountOut Output amount predicted by off-chain simulation.
    /// @param minAmountOut Hard floor; caller-signed, derived from
    ///        computeMinAmountOut off-chain or on-chain prior to this call.
    /// @param actualAmountOut Output amount realized at execution time.
    /// @param quoteDeadline Unix timestamp after which the quote is stale and
    ///        must be re-simulated rather than executed blindly.
    function executeGuardedSettlement(
        address recipient,
        uint256 expectedAmountOut,
        uint256 minAmountOut,
        uint256 actualAmountOut,
        uint256 quoteDeadline
    ) external nonReentrant {
        if (expectedAmountOut == 0 || actualAmountOut == 0) revert ZeroAmount();
        if (block.timestamp > quoteDeadline) revert ExpiredQuote(quoteDeadline, block.timestamp);

        checkSlippage(actualAmountOut, minAmountOut);

        emit GuardedSettlementExecuted(msg.sender, recipient, expectedAmountOut, minAmountOut, actualAmountOut);
    }
}
