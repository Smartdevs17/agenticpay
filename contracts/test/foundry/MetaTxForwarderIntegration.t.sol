// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../MetaTxForwarder.sol";
import "./MockReceiver.sol";

contract MetaTxForwarderIntegrationTest is Test {
    MetaTxForwarder internal forwarder;
    MockReceiver internal receiver;

    uint256 internal signerPk;
    address internal signer;

    bytes32 internal constant TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    function setUp() public {
        forwarder = new MetaTxForwarder();
        receiver = new MockReceiver();

        signerPk = 0xA11CE;
        signer = vm.addr(signerPk);
        vm.deal(address(this), 50 ether);
        vm.deal(signer, 1 ether);
    }

    function test_execute_corePaymentFlow_updatesReceiverAndNonce() public {
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("milestone-1"));

        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0.5 ether,
            gas: 200_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        bytes memory sig = _sign(req);
        vm.expectEmit(true, true, true, false);
        emit MetaTxForwarder.Executed(signer, address(receiver), 0, true, bytes(""));
        (bool ok,) = forwarder.execute{value: 0.5 ether}(req, sig);

        assertTrue(ok);
        assertEq(forwarder.nonces(signer), 1);
        assertEq(receiver.lastSender(), signer);
        assertEq(receiver.totalPaid(), 0.5 ether);
    }

    function testFuzz_verify_rejectsExpiredDeadline(uint40 offset) public {
        vm.assume(offset > 0);

        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("expired"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0,
            gas: 120_000,
            nonce: 0,
            deadline: uint48(block.timestamp - offset),
            data: callData
        });

        bytes memory sig = _sign(req);
        assertFalse(forwarder.verify(req, sig));
    }

    function testFuzz_execute_badSignatureReverts(uint256 randomPk) public {
        vm.assume(randomPk > 1 && randomPk != signerPk);

        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("bad-sig"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0,
            gas: 120_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 days),
            data: callData
        });

        bytes32 digest = _digest(req);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(randomPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(MetaTxForwarder.BadSignature.selector);
        forwarder.execute(req, sig);
    }

    function test_differential_forkAndLocalVerifyBehavior() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log("Skipping fork differential test: MAINNET_RPC_URL not set");
            return;
        }

        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("diff"));

        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0,
            gas: 120_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        bytes memory sig = _sign(req);
        bool localResult = forwarder.verify(req, sig);

        uint256 forkId = vm.createFork(rpc);
        vm.selectFork(forkId);
        MetaTxForwarder forkForwarder = new MetaTxForwarder();
        MockReceiver forkReceiver = new MockReceiver();

        MetaTxForwarder.ForwardRequest memory forkReq = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(forkReceiver),
            value: 0,
            gas: 120_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        bytes memory forkSig = _signWithForwarder(forkReq, forkForwarder);
        bool forkResult = forkForwarder.verify(forkReq, forkSig);

        assertEq(localResult, forkResult, "local and fork verification diverged");
    }

    function _sign(MetaTxForwarder.ForwardRequest memory req) internal view returns (bytes memory) {
        bytes32 digest = _digest(req);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signWithForwarder(MetaTxForwarder.ForwardRequest memory req, MetaTxForwarder f)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, req.deadline, keccak256(req.data))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", f.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _digest(MetaTxForwarder.ForwardRequest memory req) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, req.deadline, keccak256(req.data))
        );
        return keccak256(abi.encodePacked("\x19\x01", forwarder.domainSeparator(), structHash));
    }
}
