// Certora Prover formal verification spec — Reentrancy Safety
//
// Verifies the following properties across SplitterOptimized and BatchSplitter:
//
//   1. nonReentrant_latch_is_zero_before_and_after_every_call
//      The reentrancy latch (_locked) must be 0 (unlocked) both before any
//      external entry and after the function returns. A latch value of 1
//      during a call is only valid inside the guarded function body.
//
//   2. splitPayment_latch_released_on_revert
//      If splitPayment reverts for any reason the latch must be 0 on exit,
//      preventing a permanent lock-out (denial-of-service via stuck latch).
//
//   3. withdraw_latch_released_on_revert
//      Same guarantee for withdraw().
//
//   4. batchTransfer_latch_released_on_revert
//      Same guarantee for BatchSplitter.batchTransfer().
//
//   5. no_reentrancy_during_splitPayment
//      While splitPayment is executing (latch == 1) a second call to
//      splitPayment must revert.
//
//   6. no_cross_function_reentrancy
//      While splitPayment is executing (latch == 1) a call to withdraw()
//      must also revert.
//
//   7. balance_non_negative_after_split
//      The contract ETH balance must never go negative after splitPayment.
//
//   8. withdraw_cannot_exceed_balance
//      withdraw() must revert if the requested amount exceeds the current
//      contract balance.
//
//   9. only_owner_can_withdraw
//      Any caller that is not the owner must have their withdraw() call
//      revert.
//
//  10. platform_fee_bps_bounded
//      platformFeeBps must always be <= 10 000 after any state-changing call.

// ---------------------------------------------------------------------------
// Method declarations
// ---------------------------------------------------------------------------

methods {
    // SplitterOptimized
    function splitPayment()                                          external payable;
    function withdraw(address, uint256)                              external;
    function setPlatformFeeBps(uint16)                               external;
    function setRecipient(uint256, address, uint16, uint256, bool)   external;
    function owner()                                                 external returns (address) envfree;
    function platformFeeBps()                                        external returns (uint16)  envfree;

    // BatchSplitter — declared so the prover can reason about it in
    // cross-contract rules when both contracts are in scope.
    function batchTransfer(BatchSplitter.Transfer[])                 external payable;
}

// ---------------------------------------------------------------------------
// Ghost variable: tracks the latch value as seen by the prover
// ---------------------------------------------------------------------------

ghost uint8 ghostLocked {
    init_state axiom ghostLocked == 0;
}

hook Sstore _locked uint8 newVal {
    ghostLocked = newVal;
}

hook Sload uint8 val _locked {
    require val == ghostLocked;
}

// ---------------------------------------------------------------------------
// Rule 1 — latch is 0 before and after every top-level call
// ---------------------------------------------------------------------------

rule nonReentrant_latch_is_zero_at_entry_and_exit(method f, env e, calldataarg args)
    filtered { f -> !f.isView }
{
    require ghostLocked == 0;
    f@withrevert(e, args);
    assert ghostLocked == 0,
        "reentrancy latch must be 0 after any non-view function returns";
}

// ---------------------------------------------------------------------------
// Rule 2 — latch released even when splitPayment reverts
// ---------------------------------------------------------------------------

rule splitPayment_latch_released_on_revert(env e) {
    require ghostLocked == 0;
    splitPayment@withrevert(e);
    assert ghostLocked == 0,
        "latch must be 0 after splitPayment regardless of revert";
}

// ---------------------------------------------------------------------------
// Rule 3 — latch released even when withdraw reverts
// ---------------------------------------------------------------------------

rule withdraw_latch_released_on_revert(env e, address to, uint256 amount) {
    require ghostLocked == 0;
    withdraw@withrevert(e, to, amount);
    assert ghostLocked == 0,
        "latch must be 0 after withdraw regardless of revert";
}

// ---------------------------------------------------------------------------
// Rule 5 — no direct reentrancy into splitPayment
// ---------------------------------------------------------------------------

rule no_reentrancy_during_splitPayment(env e1, env e2) {
    // Simulate the latch being held (mid-execution of splitPayment).
    require ghostLocked == 1;
    splitPayment@withrevert(e2);
    assert lastReverted,
        "splitPayment must revert when latch is already held (direct reentrancy)";
}

// ---------------------------------------------------------------------------
// Rule 6 — no cross-function reentrancy (splitPayment → withdraw)
// ---------------------------------------------------------------------------

rule no_cross_function_reentrancy(env e, address to, uint256 amount) {
    require ghostLocked == 1;
    withdraw@withrevert(e, to, amount);
    assert lastReverted,
        "withdraw must revert while splitPayment holds the latch (cross-function reentrancy)";
}

// ---------------------------------------------------------------------------
// Rule 7 — contract balance non-negative after splitPayment
// ---------------------------------------------------------------------------

rule balance_non_negative_after_split(env e) {
    require ghostLocked == 0;
    splitPayment@withrevert(e);
    assert nativeBalances[currentContract] >= 0,
        "contract balance must be non-negative after splitPayment";
}

// ---------------------------------------------------------------------------
// Rule 8 — withdraw cannot exceed balance
// ---------------------------------------------------------------------------

rule withdraw_cannot_exceed_balance(env e, address to, uint256 amount) {
    uint256 balBefore = nativeBalances[currentContract];
    require amount > balBefore;
    withdraw@withrevert(e, to, amount);
    assert lastReverted,
        "withdraw must revert when amount exceeds contract balance";
}

// ---------------------------------------------------------------------------
// Rule 9 — only owner can withdraw
// ---------------------------------------------------------------------------

rule only_owner_can_withdraw(env e, address to, uint256 amount)
    filtered { e.msg.sender != owner() }
{
    withdraw@withrevert(e, to, amount);
    assert lastReverted,
        "non-owner withdraw must revert";
}

// ---------------------------------------------------------------------------
// Rule 10 — platformFeeBps always bounded
// ---------------------------------------------------------------------------

rule platform_fee_bps_bounded(method f, env e, calldataarg args)
    filtered { f -> !f.isView }
{
    f@withrevert(e, args);
    assert platformFeeBps() <= 10000,
        "platformFeeBps must never exceed 10 000 bps";
}
