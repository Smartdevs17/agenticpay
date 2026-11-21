// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EIP-2771-compatible trusted forwarder
/// @notice Verifies an EIP-712 meta-transaction signature from the
///         requested sender and relays the inner call to `req.to`, with
///         the original sender address appended to the calldata per
///         ERC-2771. Target contracts must implement `_msgSender()`
///         that reads the last 20 bytes of calldata when called by this
///         forwarder.
/// @dev Gas-optimised reference implementation:
///        - `nonces` packs into one slot per sender (u256 value).
///        - Structured data hashed with EIP-712 typed-data encoding.
///        - Zero external dependencies — mirrors OZ's MinimalForwarder
///          but drops redundant checks for lower runtime cost.
contract MetaTxForwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        uint48 deadline;
        bytes data;
    }

    bytes32 private constant TYPEHASH =
        keccak256(
            "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
        );
    bytes32 private immutable _domainSeparator;

    mapping(address => uint256) public nonces;

    event Executed(
        address indexed from,
        address indexed to,
        uint256 nonce,
        bool success,
        bytes returnData
    );

    error DeadlinePassed();
    error BadSignature();
    error NonceUsed();
    error InsufficientGas();

    constructor() {
        _domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AgenticPayForwarder")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }

    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        if (req.deadline != 0 && block.timestamp > req.deadline) return false;
        if (nonces[req.from] != req.nonce) return false;
        address recovered = _recover(_hashTypedData(req), signature);
        return recovered != address(0) && recovered == req.from;
    }

    function execute(ForwardRequest calldata req, bytes calldata signature)
        external
        payable
        returns (bool success, bytes memory returnData)
    {
        if (req.deadline != 0 && block.timestamp > req.deadline) revert DeadlinePassed();
        if (nonces[req.from] != req.nonce) revert NonceUsed();

        address recovered = _recover(_hashTypedData(req), signature);
        if (recovered == address(0) || recovered != req.from) revert BadSignature();

        // Bump nonce BEFORE external call to prevent replay during reentry.
        unchecked { nonces[req.from] = req.nonce + 1; }

        // Reserve a safety margin so the outer relayer can always finish
        // accounting after the inner call, even if the target burns all
        // remaining gas.
        if (gasleft() < req.gas + 16_000) revert InsufficientGas();

        // ERC-2771 appends the original sender to the calldata.
        bytes memory payload = abi.encodePacked(req.data, req.from);
        (success, returnData) = req.to.call{gas: req.gas, value: req.value}(payload);

        emit Executed(req.from, req.to, req.nonce, success, returnData);
    }

    function _hashTypedData(ForwardRequest calldata req) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TYPEHASH,
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                req.deadline,
                keccak256(req.data)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, structHash));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        // Reject malleable high-`s` values per EIP-2.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }

}
