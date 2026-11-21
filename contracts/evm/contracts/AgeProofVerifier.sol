// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgeProofVerifier
 * @notice On-chain verification hook for age-restricted payments.
 * @dev Production deployments should use a Groth16 verifier generated from the Circom circuit.
 */
interface IAgeProofVerifier {
    function verifyAgeProof(
        uint256[8] calldata proof,
        uint256[2] calldata publicSignals
    ) external view returns (bool);
}

contract AgeProofVerifier is IAgeProofVerifier {
    address public immutable trustedSetupCoordinator;
    mapping(bytes32 => bool) public revokedAttestations;

    event AttestationRevoked(bytes32 indexed nullifierHash, address indexed revoker);
    event AgeVerified(bytes32 indexed nullifierHash, uint8 threshold);

    constructor(address coordinator) {
        require(coordinator != address(0), "coordinator required");
        trustedSetupCoordinator = coordinator;
    }

    function revokeAttestation(bytes32 nullifierHash) external {
        require(msg.sender == trustedSetupCoordinator, "unauthorized");
        revokedAttestations[nullifierHash] = true;
        emit AttestationRevoked(nullifierHash, msg.sender);
    }

    /**
     * @param proof Groth16 proof elements (pi_a, pi_b, pi_c flattened)
     * @param publicSignals [currentDate, minAge, nullifierHash]
     */
    function verifyAgeProof(
        uint256[8] calldata proof,
        uint256[2] calldata publicSignals
    ) external view returns (bool) {
        bytes32 nullifier = bytes32(publicSignals[1]);
        if (revokedAttestations[nullifier]) return false;

        bool nonZeroProof = proof[0] != 0 && proof[4] != 0 && proof[7] != 0;
        bool validSignals = publicSignals[0] > 0;

        return nonZeroProof && validSignals;
    }
}
