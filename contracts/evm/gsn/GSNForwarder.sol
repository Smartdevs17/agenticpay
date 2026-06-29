// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GSNForwarder
/// @notice EIP-2771 trusted forwarder for the AgenticPay Gas Station Network.
///         Verifies EIP-712 meta-transaction signatures and relays calls to
///         target contracts, appending the original sender address to calldata.
///         Supports EIP-1559 fee parameters for accurate gas accounting.
contract GSNForwarder {
    // ── Types ────────────────────────────────────────────────────────────────

    struct MetaTransaction {
        address from;        // Original signer / user wallet
        address to;          // Target contract
        uint256 value;       // Native value to forward
        uint256 gas;         // Gas limit for inner call
        uint256 nonce;       // Per-sender replay protection nonce
        uint48  deadline;    // Expiry timestamp
        bytes   data;        // Encoded function call
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    bytes32 private immutable DOMAIN_SEPARATOR;

    bytes32 private constant METATX_TYPEHASH = keccak256(
        "MetaTransaction(address from,address to,uint256 value,uint256 gas,"
        "uint256 nonce,uint48 deadline,bytes data)"
    );

    mapping(address => uint256) public nonces;

    // Authorised relay servers
    mapping(address => bool) public authorizedRelayers;
    address public owner;

    // ── Events ───────────────────────────────────────────────────────────────

    event MetaTxExecuted(
        address indexed from,
        address indexed to,
        uint256 nonce,
        bool    success,
        uint256 gasUsed
    );

    event RelayerUpdated(address indexed relayer, bool authorized);

    // ── Errors ───────────────────────────────────────────────────────────────

    error Unauthorized();
    error DeadlinePassed();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error InsufficientRelayGas();

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,"
                    "uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("AgenticPayGSN")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyRelayer() {
        if (!authorizedRelayers[msg.sender]) revert Unauthorized();
        _;
    }

    // ── Relayer management ───────────────────────────────────────────────────

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    // ── Core relay ───────────────────────────────────────────────────────────

    /// @notice Execute a signed meta-transaction on behalf of `req.from`.
    /// @param req       The meta-transaction parameters.
    /// @param signature EIP-712 signature from `req.from`.
    function execute(
        MetaTransaction calldata req,
        bytes calldata signature
    ) external onlyRelayer returns (bool success, bytes memory returnData) {
        if (block.timestamp > req.deadline) revert DeadlinePassed();
        if (nonces[req.from] != req.nonce) revert NonceAlreadyUsed();

        bytes32 digest = _hashTypedData(req);
        address signer = _recover(digest, signature);
        if (signer != req.from) revert InvalidSignature();

        // Increment nonce before execution to prevent reentrancy replay
        unchecked { nonces[req.from]++; }

        uint256 gasBefore = gasleft();

        // ERC-2771: append original sender to calldata
        (success, returnData) = req.to.call{value: req.value, gas: req.gas}(
            abi.encodePacked(req.data, req.from)
        );

        uint256 gasUsed = gasBefore - gasleft();
        emit MetaTxExecuted(req.from, req.to, req.nonce, success, gasUsed);
    }

    // ── Nonce helper ─────────────────────────────────────────────────────────

    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    // ── EIP-712 ──────────────────────────────────────────────────────────────

    function _hashTypedData(MetaTransaction calldata req) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        METATX_TYPEHASH,
                        req.from,
                        req.to,
                        req.value,
                        req.gas,
                        req.nonce,
                        req.deadline,
                        keccak256(req.data)
                    )
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    // ── ECDSA ────────────────────────────────────────────────────────────────

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }

    receive() external payable {}
}
