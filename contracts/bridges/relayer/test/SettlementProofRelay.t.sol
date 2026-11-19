// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../SettlementProofRelay.sol";

/// @dev Minimal slice of the Foundry cheatcode interface so the suite needs no vendored forge-std.
interface Vm {
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function chainId(uint256 newChainId) external;
}

contract SettlementProofRelayTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant STELLAR_PUBNET = keccak256("stellar:pubnet");
    bytes32 internal constant STELLAR_TESTNET = keccak256("stellar:testnet");
    /// @dev Shared with backend/src/services/__tests__/settlementProof.test.ts — both sides must agree.
    bytes32 internal constant VECTOR_DIGEST = 0x19feb92540fc7f3429112b3b23835c7ddddf6decadd389965daac67b949e8c98;
    address internal constant VECTOR_CONTRACT = 0x00000000000000000000000000000000000000AA;

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

    SettlementProofRelay internal relay;
    uint256[3] internal keys;
    address[3] internal attesters;
    address internal constant RECIPIENT = address(0xBEEF);
    address internal constant TOKEN = address(0xCAFE);
    address internal constant RELAYER = address(0x5E1A7);
    address internal constant STRANGER = address(0xBAD);

    function setUp() public {
        keys = [uint256(0xA11CE), uint256(0xB0B), uint256(0xC4A7)];
        address[] memory initial = new address[](3);
        for (uint256 i = 0; i < 3; i++) {
            attesters[i] = vm.addr(keys[i]);
            initial[i] = attesters[i];
        }
        relay = new SettlementProofRelay(initial, 2);
        relay.setSourceChain(STELLAR_PUBNET, true);
        relay.setDestinationChain(STELLAR_PUBNET, true);
        relay.setCommitter(address(this), true);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _proof(bytes32 id) internal pure returns (SettlementProofRelay.SettlementProof memory) {
        return SettlementProofRelay.SettlementProof({
            settlementId: id,
            sourceChain: STELLAR_PUBNET,
            sourceHeight: 51_234_567,
            sourceTxHash: keccak256(abi.encode("stellar-tx", id)),
            recipient: bytes32(uint256(uint160(RECIPIENT))),
            token: bytes32(uint256(uint160(TOKEN))),
            amount: 1_250_000_000
        });
    }

    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Signatures from the given key indexes, ordered by ascending signer address.
    function _signed(SettlementProofRelay.SettlementProof memory p, uint256[] memory idx)
        internal
        view
        returns (bytes[] memory sigs)
    {
        bytes32 digest = relay.proofDigest(p);
        for (uint256 i = 0; i < idx.length; i++) {
            for (uint256 j = i + 1; j < idx.length; j++) {
                if (attesters[idx[j]] < attesters[idx[i]]) (idx[i], idx[j]) = (idx[j], idx[i]);
            }
        }
        sigs = new bytes[](idx.length);
        for (uint256 i = 0; i < idx.length; i++) {
            sigs[i] = _sig(keys[idx[i]], digest);
        }
    }

    function _pair(uint256 a, uint256 b) internal pure returns (uint256[] memory idx) {
        idx = new uint256[](2);
        idx[0] = a;
        idx[1] = b;
    }

    function _assert(bool ok, string memory reason) internal pure {
        require(ok, reason);
    }

    // ── inbound lane ────────────────────────────────────────────────────────

    function test_relaysProofWithThresholdSignatures() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-1");
        bytes[] memory sigs = _signed(p, _pair(0, 2));

        vm.expectEmit(true, true, false, true);
        emit SettlementProofRelayed(p.settlementId, STELLAR_PUBNET, p.sourceTxHash, RECIPIENT, TOKEN, p.amount, RELAYER);
        vm.prank(RELAYER);
        relay.relayProof(p, sigs);

        _assert(relay.isRelayed(p.settlementId), "not relayed");
        (bytes32 digest, bytes32 chain,, address by) = relay.relayed(p.settlementId);
        _assert(digest == relay.proofDigest(p), "digest");
        _assert(chain == STELLAR_PUBNET, "chain");
        _assert(by == RELAYER, "relayer");
    }

    function test_acceptsMoreThanThresholdSignatures() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-all");
        uint256[] memory idx = new uint256[](3);
        (idx[0], idx[1], idx[2]) = (0, 1, 2);
        relay.relayProof(p, _signed(p, idx));
        _assert(relay.isRelayed(p.settlementId), "not relayed");
    }

    function test_revertsOnReplay() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-replay");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        relay.relayProof(p, sigs);
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.AlreadyRelayed.selector, p.settlementId));
        relay.relayProof(p, sigs);
    }

    function test_revertsBelowThreshold() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-short");
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sig(keys[0], relay.proofDigest(p));
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.InsufficientSignatures.selector, 1, 2));
        relay.relayProof(p, sigs);
    }

    function test_revertsOnDuplicateSigner() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-dup");
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(keys[0], relay.proofDigest(p));
        sigs[1] = sigs[0];
        vm.expectRevert(SettlementProofRelay.SignersNotSorted.selector);
        relay.relayProof(p, sigs);
    }

    function test_revertsOnUnsortedSigners() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-order");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        (sigs[0], sigs[1]) = (sigs[1], sigs[0]);
        vm.expectRevert(SettlementProofRelay.SignersNotSorted.selector);
        relay.relayProof(p, sigs);
    }

    function test_revertsOnUnknownAttester() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-rogue");
        bytes32 digest = relay.proofDigest(p);
        uint256 rogueKey = 0xD00D;
        address rogue = vm.addr(rogueKey);
        bytes[] memory sigs = new bytes[](2);
        if (rogue < attesters[0]) {
            (sigs[0], sigs[1]) = (_sig(rogueKey, digest), _sig(keys[0], digest));
        } else {
            (sigs[0], sigs[1]) = (_sig(keys[0], digest), _sig(rogueKey, digest));
        }
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.UnknownAttester.selector, rogue));
        relay.relayProof(p, sigs);
    }

    function test_revertsWhenPayloadTamperedAfterSigning() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-tamper");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        p.amount += 1;
        // A tampered payload recovers to unrelated addresses, which are not attesters.
        bytes4 selector = SettlementProofRelay.UnknownAttester.selector;
        (bool ok, bytes memory ret) =
            address(relay).call(abi.encodeWithSelector(SettlementProofRelay.relayProof.selector, p, sigs));
        _assert(!ok, "tampered proof accepted");
        _assert(bytes4(ret) == selector || bytes4(ret) == SettlementProofRelay.SignersNotSorted.selector, "reason");
    }

    function test_revertsOnMalformedSignature() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-malformed");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        sigs[0] = hex"deadbeef";
        vm.expectRevert(SettlementProofRelay.InvalidSignature.selector);
        relay.relayProof(p, sigs);
    }

    function test_revertsOnHighSSignature() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-malleable");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        bytes32 r = bytes32(_slice(sigs[0], 0));
        bytes32 s = bytes32(_slice(sigs[0], 32));
        uint8 v = uint8(sigs[0][64]);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        sigs[0] = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(SettlementProofRelay.InvalidSignature.selector);
        relay.relayProof(p, sigs);
    }

    function test_revertsOnDisabledSourceChain() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-testnet");
        p.sourceChain = STELLAR_TESTNET;
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.SourceChainDisabled.selector, STELLAR_TESTNET));
        relay.relayProof(p, sigs);
    }

    function test_revertsOnNonEvmRecipient() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-g-account");
        p.recipient = keccak256("stellar-ed25519-key");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.NonEvmAddress.selector, p.recipient));
        relay.relayProof(p, sigs);
    }

    function test_revertsOnZeroAmount() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-zero");
        p.amount = 0;
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        vm.expectRevert(SettlementProofRelay.InvalidAmount.selector);
        relay.relayProof(p, sigs);
    }

    function test_revertsWhenPaused() public {
        relay.setPaused(true);
        SettlementProofRelay.SettlementProof memory p = _proof("settle-paused");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        vm.expectRevert(SettlementProofRelay.Paused.selector);
        relay.relayProof(p, sigs);
    }

    function test_removedAttesterSignatureIsRejected() public {
        relay.setAttester(attesters[2], false);
        SettlementProofRelay.SettlementProof memory p = _proof("settle-rotated");
        bytes[] memory sigs = _signed(p, _pair(0, 2));
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.UnknownAttester.selector, attesters[2]));
        relay.relayProof(p, sigs);
    }

    function test_digestBindsChainId() public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-domain");
        bytes32 before = relay.proofDigest(p);
        vm.chainId(8453);
        _assert(relay.proofDigest(p) != before, "chain id not bound");
    }

    function test_digestMatchesBackendVector() public {
        vm.chainId(1);
        SettlementProofRelay.SettlementProof memory p = SettlementProofRelay.SettlementProof({
            settlementId: keccak256("vector-settlement"),
            sourceChain: STELLAR_PUBNET,
            sourceHeight: 51_234_567,
            sourceTxHash: keccak256("vector-tx"),
            recipient: bytes32(uint256(uint160(RECIPIENT))),
            token: bytes32(uint256(uint160(TOKEN))),
            amount: 1_250_000_000
        });
        bytes32 structHash = keccak256(
            abi.encode(
                relay.SETTLEMENT_PROOF_TYPEHASH(),
                p.settlementId,
                p.sourceChain,
                p.sourceHeight,
                p.sourceTxHash,
                p.recipient,
                p.token,
                p.amount
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgenticPaySettlementProofRelay"),
                keccak256("1"),
                uint256(1),
                VECTOR_CONTRACT
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        _assert(digest == VECTOR_DIGEST, "backend digest vector drifted");
    }

    // ── outbound lane ───────────────────────────────────────────────────────

    function test_commitsOutboundSettlement() public {
        bytes32 stellarRecipient = keccak256("stellar-ed25519-key");
        vm.expectEmit(true, true, false, true);
        emit SettlementCommitted("out-1", STELLAR_PUBNET, stellarRecipient, bytes32(0), 42, address(this));
        relay.commitSettlement("out-1", STELLAR_PUBNET, stellarRecipient, bytes32(0), 42);
        _assert(relay.committed("out-1"), "not committed");
    }

    function test_commitRejectsDuplicates() public {
        relay.commitSettlement("out-dup", STELLAR_PUBNET, bytes32(uint256(1)), bytes32(0), 42);
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.AlreadyCommitted.selector, bytes32("out-dup")));
        relay.commitSettlement("out-dup", STELLAR_PUBNET, bytes32(uint256(1)), bytes32(0), 42);
    }

    function test_commitRejectsUnauthorisedCaller() public {
        vm.prank(STRANGER);
        vm.expectRevert(SettlementProofRelay.NotCommitter.selector);
        relay.commitSettlement("out-x", STELLAR_PUBNET, bytes32(uint256(1)), bytes32(0), 42);
    }

    function test_commitRejectsDisabledDestination() public {
        vm.expectRevert(abi.encodeWithSelector(SettlementProofRelay.DestinationChainDisabled.selector, STELLAR_TESTNET));
        relay.commitSettlement("out-y", STELLAR_TESTNET, bytes32(uint256(1)), bytes32(0), 42);
    }

    // ── administration ──────────────────────────────────────────────────────

    function test_adminFunctionsAreOwnerOnly() public {
        vm.prank(STRANGER);
        vm.expectRevert(SettlementProofRelay.NotOwner.selector);
        relay.setThreshold(1);
        vm.prank(STRANGER);
        vm.expectRevert(SettlementProofRelay.NotOwner.selector);
        relay.setAttester(STRANGER, true);
        vm.prank(STRANGER);
        vm.expectRevert(SettlementProofRelay.NotOwner.selector);
        relay.setPaused(true);
    }

    function test_thresholdCannotExceedAttesterSet() public {
        vm.expectRevert(SettlementProofRelay.InvalidThreshold.selector);
        relay.setThreshold(4);
        vm.expectRevert(SettlementProofRelay.InvalidThreshold.selector);
        relay.setThreshold(0);
        relay.setThreshold(3);
        vm.expectRevert(SettlementProofRelay.InvalidThreshold.selector);
        relay.setAttester(attesters[0], false);
    }

    function test_constructorRejectsInvalidThreshold() public {
        address[] memory one = new address[](1);
        one[0] = attesters[0];
        vm.expectRevert(SettlementProofRelay.InvalidThreshold.selector);
        new SettlementProofRelay(one, 2);
    }

    function test_transferOwnership() public {
        relay.transferOwnership(STRANGER);
        _assert(relay.owner() == STRANGER, "owner");
        vm.expectRevert(SettlementProofRelay.NotOwner.selector);
        relay.setPaused(true);
    }

    function testFuzz_rejectsAnyTamperedAmount(uint256 delta) public {
        SettlementProofRelay.SettlementProof memory p = _proof("settle-fuzz");
        bytes[] memory sigs = _signed(p, _pair(0, 1));
        unchecked {
            p.amount += delta == 0 ? 1 : delta;
        }
        if (p.amount == 0) p.amount = 7;
        (bool ok,) = address(relay).call(abi.encodeWithSelector(SettlementProofRelay.relayProof.selector, p, sigs));
        _assert(!ok, "tampered proof accepted");
    }

    function _slice(bytes memory data, uint256 offset) private pure returns (uint256 word) {
        assembly {
            word := mload(add(add(data, 32), offset))
        }
    }
}
