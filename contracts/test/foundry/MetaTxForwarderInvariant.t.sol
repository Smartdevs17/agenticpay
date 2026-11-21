// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../MetaTxForwarder.sol";
import "./MockReceiver.sol";

contract MetaTxForwarderHandler is Test {
    MetaTxForwarder public immutable forwarder;
    MockReceiver public immutable receiver;
    uint256 public immutable signerPk;
    address public immutable signer;

    uint256 public successfulExecs;

    bytes32 private constant TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    constructor(MetaTxForwarder _forwarder, MockReceiver _receiver, uint256 _signerPk) {
        forwarder = _forwarder;
        receiver = _receiver;
        signerPk = _signerPk;
        signer = vm.addr(_signerPk);
    }

    function tryExecute(uint96 payment, uint40 ttl) external {
        uint256 nonce = forwarder.nonces(signer);
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("invariant"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: uint256(payment) % 0.01 ether,
            gas: 200_000,
            nonce: nonce,
            deadline: uint48(block.timestamp + (ttl % 1 days) + 1),
            data: callData
        });

        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, req.deadline, keccak256(req.data))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", forwarder.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.deal(address(this), address(this).balance + req.value);
        (bool ok,) = forwarder.execute{value: req.value}(req, sig);
        if (ok) successfulExecs++;
    }
}

contract MetaTxForwarderInvariantTest is StdInvariant, Test {
    MetaTxForwarder internal forwarder;
    MockReceiver internal receiver;
    MetaTxForwarderHandler internal handler;

    uint256 internal signerPk;
    address internal signer;

    function setUp() public {
        forwarder = new MetaTxForwarder();
        receiver = new MockReceiver();

        signerPk = 0xB0B;
        signer = vm.addr(signerPk);

        handler = new MetaTxForwarderHandler(forwarder, receiver, signerPk);
        vm.deal(address(handler), 5 ether);

        targetContract(address(handler));
    }

    function invariant_nonceMonotonicAndBoundedBySuccessCount() public view {
        uint256 nonce = forwarder.nonces(signer);
        assertGe(nonce, 0);
        assertEq(nonce, handler.successfulExecs());
    }
}
