// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SettlementProofRelay
 * @notice EVM endpoint of the Stellar <-> EVM settlement proof lanes.
 *
 *         Inbound  (stellar -> evm): an off-chain relayer collects EIP-712
 *         attestations from an M-of-N attester set over a settlement that
 *         finalised on Stellar, and submits them through {relayProof}. Each
 *         settlement id can be accepted exactly once.
 *
 *         Outbound (evm -> stellar): authorised settlement engines record a
 *         settlement through {commitSettlement}. The emitted
 *         {SettlementCommitted} event is the source observation the relayer
 *         attests to and delivers to the Soroban side.
 *
 * @dev    Recipient and token are carried as bytes32 so both lanes share one
 *         proof shape: a Stellar ed25519 key / Soroban contract id fills all 32
 *         bytes, an EVM address is left-padded with zeros. The backend mirror of
 *         this struct lives in backend/src/services/settlementProof.ts and both
 *         sides are pinned to the same digest test vector.
 */
contract SettlementProofRelay {
    struct SettlementProof {
        bytes32 settlementId;
        bytes32 sourceChain;
        uint64 sourceHeight;
        bytes32 sourceTxHash;
        bytes32 recipient;
        bytes32 token;
        uint256 amount;
    }

    struct RelayedProof {
        bytes32 digest;
        bytes32 sourceChain;
        uint64 relayedAt;
        address relayer;
    }

    bytes32 public constant SETTLEMENT_PROOF_TYPEHASH = keccak256(
        "SettlementProof(bytes32 settlementId,bytes32 sourceChain,uint64 sourceHeight,bytes32 sourceTxHash,bytes32 recipient,bytes32 token,uint256 amount)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("AgenticPaySettlementProofRelay");
    bytes32 private constant VERSION_HASH = keccak256("1");
    /// @dev secp256k1n / 2 — signatures with a higher s are malleable and rejected.
    uint256 private constant MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address public owner;
    bool public paused;
    uint8 public threshold;
    uint16 public attesterCount;

    mapping(address => bool) public isAttester;
    mapping(address => bool) public isCommitter;
    mapping(bytes32 => bool) public isSourceChainEnabled;
    mapping(bytes32 => bool) public isDestinationChainEnabled;
    mapping(bytes32 => RelayedProof) public relayed;
    mapping(bytes32 => bool) public committed;

    event SettlementProofRelayed(
        bytes32 indexed settlementId,
        bytes32 indexed sourceChain,
        bytes32 sourceTxHash,
        address recipient,
        address token,
        uint256 amount,
        address relayer
    );
    event SettlementCommitted(
        bytes32 indexed settlementId,
        bytes32 indexed destinationChain,
        bytes32 recipient,
        bytes32 token,
        uint256 amount,
        address committer
    );
    event AttesterUpdated(address indexed attester, bool enabled);
    event CommitterUpdated(address indexed committer, bool enabled);
    event ThresholdUpdated(uint8 threshold);
    event SourceChainUpdated(bytes32 indexed chain, bool enabled);
    event DestinationChainUpdated(bytes32 indexed chain, bool enabled);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotCommitter();
    error Paused();
    error ZeroAddress();
    error InvalidThreshold();
    error SourceChainDisabled(bytes32 chain);
    error DestinationChainDisabled(bytes32 chain);
    error AlreadyRelayed(bytes32 settlementId);
    error AlreadyCommitted(bytes32 settlementId);
    error InvalidAmount();
    error NonEvmAddress(bytes32 value);
    error InsufficientSignatures(uint256 valid, uint256 required);
    error InvalidSignature();
    error UnknownAttester(address signer);
    error SignersNotSorted();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(address[] memory attesters, uint8 threshold_) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        for (uint256 i = 0; i < attesters.length; i++) {
            _setAttester(attesters[i], true);
        }
        _setThreshold(threshold_);
    }

    // ── Inbound lane: stellar -> evm ────────────────────────────────────────

    /**
     * @notice Accept a settlement proof attested by at least `threshold` attesters.
     * @param proof       The settlement observed on the source chain.
     * @param signatures  65-byte (r,s,v) EIP-712 signatures, ordered by strictly
     *                    ascending signer address so duplicates cannot be counted twice.
     */
    function relayProof(SettlementProof calldata proof, bytes[] calldata signatures) external whenNotPaused {
        if (!isSourceChainEnabled[proof.sourceChain]) revert SourceChainDisabled(proof.sourceChain);
        if (relayed[proof.settlementId].digest != bytes32(0)) revert AlreadyRelayed(proof.settlementId);
        if (proof.amount == 0) revert InvalidAmount();
        address recipient = _toAddress(proof.recipient);
        address token = _toAddress(proof.token);
        if (signatures.length < threshold) revert InsufficientSignatures(signatures.length, threshold);

        bytes32 digest = proofDigest(proof);
        address previous = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recover(digest, signatures[i]);
            if (signer <= previous) revert SignersNotSorted();
            if (!isAttester[signer]) revert UnknownAttester(signer);
            previous = signer;
        }

        relayed[proof.settlementId] = RelayedProof({
            digest: digest,
            sourceChain: proof.sourceChain,
            relayedAt: uint64(block.timestamp),
            relayer: msg.sender
        });
        emit SettlementProofRelayed(
            proof.settlementId, proof.sourceChain, proof.sourceTxHash, recipient, token, proof.amount, msg.sender
        );
    }

    /// @notice True once a proof for `settlementId` has been accepted.
    function isRelayed(bytes32 settlementId) external view returns (bool) {
        return relayed[settlementId].digest != bytes32(0);
    }

    // ── Outbound lane: evm -> stellar ───────────────────────────────────────

    /**
     * @notice Record a settlement destined for another chain. The relayer watches
     *         {SettlementCommitted} and delivers an attested proof to the destination.
     */
    function commitSettlement(bytes32 settlementId, bytes32 destinationChain, bytes32 recipient, bytes32 token, uint256 amount)
        external
        whenNotPaused
    {
        if (!isCommitter[msg.sender]) revert NotCommitter();
        if (!isDestinationChainEnabled[destinationChain]) revert DestinationChainDisabled(destinationChain);
        if (committed[settlementId]) revert AlreadyCommitted(settlementId);
        if (amount == 0) revert InvalidAmount();
        committed[settlementId] = true;
        emit SettlementCommitted(settlementId, destinationChain, recipient, token, amount, msg.sender);
    }

    // ── Digest ──────────────────────────────────────────────────────────────

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function proofDigest(SettlementProof calldata proof) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_PROOF_TYPEHASH,
                proof.settlementId,
                proof.sourceChain,
                proof.sourceHeight,
                proof.sourceTxHash,
                proof.recipient,
                proof.token,
                proof.amount
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    // ── Administration ──────────────────────────────────────────────────────

    function setAttester(address attester, bool enabled) external onlyOwner {
        _setAttester(attester, enabled);
        if (threshold > attesterCount) revert InvalidThreshold();
    }

    function setThreshold(uint8 threshold_) external onlyOwner {
        _setThreshold(threshold_);
    }

    function setCommitter(address committer, bool enabled) external onlyOwner {
        if (committer == address(0)) revert ZeroAddress();
        isCommitter[committer] = enabled;
        emit CommitterUpdated(committer, enabled);
    }

    function setSourceChain(bytes32 chain, bool enabled) external onlyOwner {
        isSourceChainEnabled[chain] = enabled;
        emit SourceChainUpdated(chain, enabled);
    }

    function setDestinationChain(bytes32 chain, bool enabled) external onlyOwner {
        isDestinationChainEnabled[chain] = enabled;
        emit DestinationChainUpdated(chain, enabled);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── Internals ───────────────────────────────────────────────────────────

    function _setAttester(address attester, bool enabled) private {
        if (attester == address(0)) revert ZeroAddress();
        if (isAttester[attester] == enabled) return;
        isAttester[attester] = enabled;
        if (enabled) {
            attesterCount += 1;
        } else {
            attesterCount -= 1;
        }
        emit AttesterUpdated(attester, enabled);
    }

    function _setThreshold(uint8 threshold_) private {
        if (threshold_ == 0 || threshold_ > attesterCount) revert InvalidThreshold();
        threshold = threshold_;
        emit ThresholdUpdated(threshold_);
    }

    function _toAddress(bytes32 value) private pure returns (address) {
        if (uint256(value) >> 160 != 0) revert NonEvmAddress(value);
        return address(uint160(uint256(value)));
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > MAX_S || (v != 27 && v != 28)) revert InvalidSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
