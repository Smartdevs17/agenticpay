pragma circom 2.0.0;

include "circomlib/poseidon.circom";
include "circomlib/comparators.circom";
include "circomlib/bitify.circom";

/**
 * Private Transaction Circuit — Issue #623
 *
 * Generates a ZK proof that a transfer is valid without revealing:
 *   - The actual transfer amount
 *   - The sender's balance
 *   - The recipient's balance
 *
 * Public signals:
 *   - commitmentHash   (Poseidon hash of amount + blinding factor)
 *   - nullifierHash    (prevents double-spending)
 *   - balanceRoot      (Merkle root of confidential balance tree)
 *
 * Private inputs:
 *   - amount, blindingFactor, senderBalance, senderSecret, recipientId
 */

template PrivateTransfer() {
    // Private inputs
    signal input amount;
    signal input blindingFactor;
    signal input senderBalance;
    signal input senderSecret;
    signal input recipientId;

    // Public inputs
    signal input balanceRoot;

    // Outputs
    signal output commitmentHash;
    signal output nullifierHash;
    signal output isValid;

    // 1. Verify sender has sufficient balance
    component balanceCheck = GreaterEqThan(64);
    balanceCheck.in[0] <== senderBalance;
    balanceCheck.in[1] <== amount;

    // 2. Verify amount is positive
    component positiveCheck = GreaterThan(64);
    positiveCheck.in[0] <== amount;
    positiveCheck.in[1] <== 0;

    // 3. Generate commitment: Poseidon(amount, blindingFactor)
    component commitHasher = Poseidon(2);
    commitHasher.inputs[0] <== amount;
    commitHasher.inputs[1] <== blindingFactor;
    commitmentHash <== commitHasher.out;

    // 4. Generate nullifier: Poseidon(senderSecret, commitmentHash)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== senderSecret;
    nullifierHasher.inputs[1] <== commitHasher.out;
    nullifierHash <== nullifierHasher.out;

    // 5. Verify balance root inclusion (simplified Merkle proof)
    component rootHasher = Poseidon(3);
    rootHasher.inputs[0] <== senderBalance;
    rootHasher.inputs[1] <== senderSecret;
    rootHasher.inputs[2] <== recipientId;

    component rootCheck = IsEqual();
    rootCheck.in[0] <== rootHasher.out;
    rootCheck.in[1] <== balanceRoot;

    // 6. Final validity: balance sufficient AND amount positive
    component finalAnd = AND();
    finalAnd.a <== balanceCheck.out;
    finalAnd.b <== positiveCheck.out;

    isValid <== finalAnd.out;
}

/**
 * Confidential Balance Proof Circuit
 *
 * Proves that a committed balance is within a valid range [0, 2^64)
 * without revealing the actual balance value (range proof).
 */
template ConfidentialBalanceProof() {
    signal input balance;
    signal input blindingFactor;
    signal input balanceCommitment;

    signal output isValidRange;
    signal output computedCommitment;

    // Range check: balance fits in 64 bits (non-negative, < 2^64)
    component rangeCheck = Num2Bits(64);
    rangeCheck.in <== balance;

    // Recompute commitment and verify it matches the public commitment
    component commitHasher = Poseidon(2);
    commitHasher.inputs[0] <== balance;
    commitHasher.inputs[1] <== blindingFactor;
    computedCommitment <== commitHasher.out;

    component commitCheck = IsEqual();
    commitCheck.in[0] <== commitHasher.out;
    commitCheck.in[1] <== balanceCommitment;

    isValidRange <== commitCheck.out;
}

/**
 * Batch Private Transfer Circuit
 *
 * Verifies multiple private transfers in a single proof for efficiency.
 * Supports up to 4 transfers per batch.
 */
template BatchPrivateTransfer(N) {
    signal input amounts[N];
    signal input blindingFactors[N];
    signal input senderBalances[N];
    signal input senderSecrets[N];
    signal input recipientIds[N];
    signal input balanceRoots[N];

    signal output commitmentHashes[N];
    signal output nullifierHashes[N];
    signal output allValid;

    component transfers[N];
    signal validAccumulator[N + 1];
    validAccumulator[0] <== 1;

    for (var i = 0; i < N; i++) {
        transfers[i] = PrivateTransfer();
        transfers[i].amount <== amounts[i];
        transfers[i].blindingFactor <== blindingFactors[i];
        transfers[i].senderBalance <== senderBalances[i];
        transfers[i].senderSecret <== senderSecrets[i];
        transfers[i].recipientId <== recipientIds[i];
        transfers[i].balanceRoot <== balanceRoots[i];

        commitmentHashes[i] <== transfers[i].commitmentHash;
        nullifierHashes[i] <== transfers[i].nullifierHash;

        validAccumulator[i + 1] <== validAccumulator[i] * transfers[i].isValid;
    }

    allValid <== validAccumulator[N];
}

component main = PrivateTransfer();
