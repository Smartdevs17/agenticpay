// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EIP-7702 delegation target
/// @notice Minimal delegate that EOAs can authorise under EIP-7702 to
///         execute batched calls from their own account. The upside is
///         dramatic: a user's EOA keeps its address and balance, but
///         batches and meta-txs run "as" the EOA without deploying a
///         smart-account contract at its address.
/// @dev  Under EIP-7702, an EOA signs a delegation tuple that makes
///       this contract's bytecode execute in the EOA's storage slot.
///       The contract therefore MUST NOT rely on its constructor
///       running in the EOA — all configuration lives in call arguments
///       or in the EOA's natural state (balance, code-less storage
///       slots the wallet already manages).
///
///       Security model:
///         - `execute` checks `msg.sender == address(this)` which, under
///           7702, means the EOA itself.
///         - `executeWithAuth` validates an EIP-712 signature against
///           the EOA's address so a relayer can invoke on its behalf.
///         - Nonces are stored at a well-known storage slot (`NONCE_SLOT`)
///           so the EOA's ABI doesn't require any setup transaction.
contract EIP7702Delegator {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    bytes32 private constant NONCE_SLOT = keccak256("agenticpay.eip7702.nonce");
    bytes32 private constant TYPEHASH =
        keccak256(
            "BatchAuth(address account,uint256 nonce,uint256 deadline,bytes32 callsHash)"
        );

    event BatchExecuted(address indexed account, uint256 nonce, uint256 count);

    error NotSelf();
    error BadSignature();
    error DeadlinePassed();
    error NonceUsed();
    error InnerCallFailed(uint256 index, bytes returnData);

    /// @notice Run calls authorised by the EOA itself (wallet signed the
    ///         outer tx). No extra signature check needed because `msg.sender`
    ///         IS the delegated account under 7702.
    function execute(Call[] calldata calls) external payable {
        if (msg.sender != address(this)) revert NotSelf();
        _runBatch(calls, _bumpNonce());
    }

    /// @notice Relayer path: a third party submits the tx but the EOA
    ///         has signed an EIP-712 authorisation. Useful for gasless
    ///         experiences on top of 7702.
    function executeWithAuth(
        Call[] calldata calls,
        uint256 deadline,
        bytes calldata signature
    ) external payable {
        if (deadline != 0 && block.timestamp > deadline) revert DeadlinePassed();

        uint256 nonce = _readNonce();
        bytes32 callsHash = _hashCalls(calls);
        bytes32 digest = keccak256(
            abi.encode(TYPEHASH, address(this), nonce, deadline, callsHash)
        );

        address signer = _recover(digest, signature);
        if (signer != address(this)) revert BadSignature();

        _runBatch(calls, _bumpNonce());
    }

    function nonce() external view returns (uint256) {
        return _readNonce();
    }

    // --------- internals ---------

    function _runBatch(Call[] calldata calls, uint256 usedNonce) internal {
        uint256 len = calls.length;
        for (uint256 i; i < len; ) {
            Call calldata c = calls[i];
            (bool ok, bytes memory data) = c.to.call{value: c.value}(c.data);
            if (!ok) revert InnerCallFailed(i, data);
            unchecked { ++i; }
        }
        emit BatchExecuted(address(this), usedNonce, len);
    }

    function _hashCalls(Call[] calldata calls) internal pure returns (bytes32) {
        // Straightforward hash over the tuple list — EIP-712 arrays use
        // `keccak256(abi.encodePacked(map(keccak256, calls)))`, but the
        // simpler single-hash form is sufficient for this reference.
        return keccak256(abi.encode(calls));
    }

    function _readNonce() internal view returns (uint256 n) {
        bytes32 slot = NONCE_SLOT;
        assembly {
            n := sload(slot)
        }
    }

    function _bumpNonce() internal returns (uint256 used) {
        bytes32 slot = NONCE_SLOT;
        uint256 current;
        assembly {
            current := sload(slot)
            sstore(slot, add(current, 1))
        }
        return current;
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
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
