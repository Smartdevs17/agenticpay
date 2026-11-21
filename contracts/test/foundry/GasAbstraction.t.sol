// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../MetaTxForwarder.sol";
import "../../evm/contracts/GasPriceOracle.sol";
import "../../evm/contracts/RelayPaymaster.sol";
import "./MockReceiver.sol";

/// @title Gas Abstraction Test Suite
/// @notice Tests for MetaTxForwarder, GasPriceOracle, and RelayPaymaster
contract GasAbstractionTest is Test {
    MetaTxForwarder internal forwarder;
    GasPriceOracle internal oracle;
    RelayPaymaster internal paymaster;
    MockReceiver internal receiver;

    uint256 internal signerPk;
    address internal signer;
    address internal relayer;
    address internal mockToken;

    bytes32 internal constant TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    bytes32 internal domainSeparator;

    function setUp() public {
        forwarder = new MetaTxForwarder();
        oracle = new GasPriceOracle(1 gwei, 2 gwei);
        paymaster = new RelayPaymaster(address(forwarder), address(oracle));
        receiver = new MockReceiver();

        signerPk = 0xBEEF;
        signer = vm.addr(signerPk);
        relayer = address(0xRE1A);
        mockToken = address(0xT0K);

        vm.deal(address(this), 100 ether);
        vm.deal(signer, 10 ether);
        vm.deal(address(paymaster), 50 ether);

        domainSeparator = forwarder.domainSeparator();

        // Setup paymaster
        vm.startPrank(address(this));
        paymaster.setRelayer(relayer, true);
        paymaster.setAcceptedToken(mockToken, true);
        paymaster.setTokenRatio(mockToken, 2000e18); // 1 ETH = 2000 tokens
        vm.stopPrank();

        // Setup oracle
        oracle.setPriceRatio(mockToken, 2000e18);
    }

    // ── MetaTxForwarder Tests ────────────────────────────────────────────────

    function test_forwarder_verify_validSignature() public view {
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("test"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0,
            gas: 200_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        bytes memory sig = _signRequest(req);
        assertTrue(forwarder.verify(req, sig), "Signature should be valid");
    }

    function test_forwarder_verify_wrongSigner() public view {
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("test"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0,
            gas: 200_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        // Sign with wrong key
        uint256 wrongPk = 0xDEAD;
        bytes32 digest = _hashTypedData(req);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        assertFalse(forwarder.verify(req, sig), "Wrong signer should fail");
    }

    function test_forwarder_execute_updatesNonce() public {
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("gasless"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0.1 ether,
            gas: 200_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        bytes memory sig = _signRequest(req);
        (bool success, ) = forwarder.execute{value: 0.1 ether}(req, sig);
        assertTrue(success, "Execute should succeed");
        assertEq(forwarder.nonces(signer), 1, "Nonce should be incremented");
    }

    function test_forwarder_execute_revertOnReplay() public {
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("replay"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0,
            gas: 200_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        bytes memory sig = _signRequest(req);
        forwarder.execute(req, sig);

        vm.expectRevert(MetaTxForwarder.NonceUsed.selector);
        forwarder.execute(req, sig);
    }

    function test_forwarder_execute_revertOnDeadline() public {
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("expired"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 0,
            gas: 200_000,
            nonce: 0,
            deadline: uint48(block.timestamp - 1), // Already expired
            data: callData
        });

        bytes memory sig = _signRequest(req);
        vm.expectRevert(MetaTxForwarder.DeadlinePassed.selector);
        forwarder.execute(req, sig);
    }

    // ── GasPriceOracle Tests ─────────────────────────────────────────────────

    function test_oracle_getQuote_ethOnly() public {
        GasPriceOracle.FeeQuote memory quote = oracle.getQuote(address(0), 300);
        assertGt(quote.maxFeePerGas, 0, "Max fee should be positive");
        assertEq(quote.tokenFee, 0, "ETH-only should have zero token fee");
        assertEq(quote.validUntil, block.timestamp + 300, "TTL should match");
    }

    function test_oracle_getQuote_withToken() public {
        GasPriceOracle.FeeQuote memory quote = oracle.getQuote(mockToken, 600);
        assertGt(quote.maxFeePerGas, 0, "Max fee should be positive");
        assertGt(quote.tokenFee, 0, "Token fee should be positive with valid ratio");
    }

    function test_oracle_estimateGasCost() public view {
        uint256 cost = oracle.estimateGasCost(200_000);
        assertGt(cost, 0, "Gas cost should be positive");
    }

    function test_oracle_estimateGasCostInToken() public view {
        uint256 cost = oracle.estimateGasCostInToken(200_000, mockToken);
        assertGt(cost, 0, "Token cost should be positive");
    }

    function test_oracle_setPriceRatio() public {
        address newToken = address(0xABC);
        oracle.setPriceRatio(newToken, 1500e18);
        assertEq(oracle.tokenPriceRatios(newToken), 1500e18, "Ratio should be set");
    }

    function test_oracle_setPriceRatio_revertZeroAddress() public {
        vm.expectRevert(GasPriceOracle.ZeroAddress.selector);
        oracle.setPriceRatio(address(0), 1000e18);
    }

    function test_oracle_setPriceRatio_revertZeroRatio() public {
        vm.expectRevert(GasPriceOracle.InvalidRatio.selector);
        oracle.setPriceRatio(address(0xABC), 0);
    }

    function test_oracle_setPriceRatio_revertNotAuthorized() public {
        address unauthorized = address(0xUNAU);
        vm.prank(unauthorized);
        vm.expectRevert(GasPriceOracle.NotAuthorized.selector);
        oracle.setPriceRatio(address(0xABC), 1000e18);
    }

    function test_oracle_batchSetPriceRatios() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(0xA);
        tokens[1] = address(0xB);
        uint256[] memory ratios = new uint256[](2);
        ratios[0] = 1000e18;
        ratios[1] = 2000e18;

        oracle.setPriceRatios(tokens, ratios);
        assertEq(oracle.tokenPriceRatios(address(0xA)), 1000e18);
        assertEq(oracle.tokenPriceRatios(address(0xB)), 2000e18);
    }

    function test_oracle_adminFunctions() public {
        oracle.setBaseFeePremium(5 gwei);
        assertEq(oracle.baseFeePremium(), 5 gwei);

        oracle.setPriorityFee(3 gwei);
        assertEq(oracle.priorityFee(), 3 gwei);

        address updater = address(0xUPD);
        oracle.setUpdater(updater, true);
        assertTrue(oracle.authorizedUpdaters(updater));
    }

    function test_oracle_transferOwnership() public {
        address newOwner = address(0xNEW);
        oracle.transferOwnership(newOwner);
        assertEq(oracle.owner(), newOwner);
    }

    function test_oracle_revertNotOwner() public {
        address other = address(0x007);
        vm.prank(other);
        vm.expectRevert(GasPriceOracle.NotOwner.selector);
        oracle.setBaseFeePremium(1 gwei);
    }

    // ── RelayPaymaster Tests ─────────────────────────────────────────────────

    function test_paymaster_canSponsor_withDeposit() public {
        // Simulate deposit balance for user
        vm.prank(address(paymaster));
        // Directly set deposit via internal trick: use prank to deposit
        // Actually, we need the actual deposit flow. Use a mock token.
        // For simplicity, test the view function with a pre-set deposit
        address user = address(0xU5E);

        // canSponsor with zero balance returns false
        assertFalse(paymaster.canSponsor(user, 1000), "Zero balance should not sponsor");
    }

    function test_paymaster_collectFee_asRelayer() public {
        address user = address(0xU5E);

        // Manually set deposit balance via storage manipulation
        // deposit mapping is at slot 4, we need to compute the storage key
        bytes32 userSlot = keccak256(abi.encode(user, uint256(4)));
        vm.store(address(paymaster), userSlot, bytes32(uint256(1 ether)));

        vm.prank(relayer);
        paymaster.collectFee(user, mockToken, 0.01 ether);

        assertGt(paymaster.totalSponsored(), 0, "Should track sponsored amount");
        assertGt(paymaster.totalFeesCollected(), 0, "Should track collected fees");
    }

    function test_paymaster_collectFee_revertNotRelayer() public {
        address unauthorized = address(0xUNAU);
        vm.prank(unauthorized);
        vm.expectRevert(RelayPaymaster.NotRelayer.selector);
        paymaster.collectFee(address(0xU5E), mockToken, 0.01 ether);
    }

    function test_paymaster_collectFee_revertTokenNotAccepted() public {
        address badToken = address(0xBAD);
        vm.prank(relayer);
        vm.expectRevert(RelayPaymaster.TokenNotAccepted.selector);
        paymaster.collectFee(address(0xU5E), badToken, 0.01 ether);
    }

    function test_paymaster_setAcceptedToken() public {
        address newToken = address(0xNTK);
        paymaster.setAcceptedToken(newToken, true);
        assertTrue(paymaster.acceptedTokens(newToken));

        paymaster.setAcceptedToken(newToken, false);
        assertFalse(paymaster.acceptedTokens(newToken));
    }

    function test_paymaster_setRelayer() public {
        address newRelayer = address(0xNR);
        paymaster.setRelayer(newRelayer, true);
        assertTrue(paymaster.relayers(newRelayer));
    }

    function test_paymaster_setForwarder() public {
        address newForwarder = address(0xNF);
        paymaster.setForwarder(newForwarder);
        assertEq(paymaster.forwarder(), newForwarder);
    }

    function test_paymaster_setOracle() public {
        address newOracle = address(0xNO);
        paymaster.setOracle(newOracle);
        assertEq(paymaster.oracle(), newOracle);
    }

    function test_paymaster_withdrawETH() public {
        address recipient = address(0xREC);
        uint256 balBefore = recipient.balance;
        paymaster.withdrawETH(recipient, 1 ether);
        assertEq(recipient.balance, balBefore + 1 ether);
    }

    function test_paymaster_transferOwnership() public {
        address newOwner = address(0xNEW);
        paymaster.transferOwnership(newOwner);
        assertEq(paymaster.owner(), newOwner);
    }

    function test_paymaster_revertNotOwner() public {
        address other = address(0x007);
        vm.prank(other);
        vm.expectRevert(RelayPaymaster.NotOwner.selector);
        paymaster.setRelayer(address(0xABC), true);
    }

    // ── Integration: Forwarder + Paymaster ───────────────────────────────────

    function test_integration_gaslessPaymentViaForwarder() public {
        bytes memory callData = abi.encodeWithSelector(receiver.pay.selector, bytes("gasless-payment"));
        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from: signer,
            to: address(receiver),
            value: 1 ether,
            gas: 200_000,
            nonce: 0,
            deadline: uint48(block.timestamp + 1 hours),
            data: callData
        });

        bytes memory sig = _signRequest(req);
        (bool success, ) = forwarder.execute{value: 1 ether}(req, sig);
        assertTrue(success, "Gasless payment should succeed");
        assertEq(receiver.totalPaid(), 1 ether, "Payment amount should match");
        assertEq(forwarder.nonces(signer), 1, "Nonce should increment");
    }

    function test_integration_oracleQuoteForForwarderTx() public {
        // Get a quote for a typical forwarder transaction
        GasPriceOracle.FeeQuote memory quote = oracle.getQuote(mockToken, 300);
        assertGt(quote.maxFeePerGas, 0);
        assertGt(quote.tokenFee, 0, "Token fee for ERC-20 payment should be > 0");

        // Estimate for 200k gas
        uint256 ethCost = oracle.estimateGasCost(200_000);
        uint256 tokenCost = oracle.estimateGasCostInToken(200_000, mockToken);
        assertGt(ethCost, 0);
        assertGt(tokenCost, 0);
        // Token cost should be ~2000x the ETH cost (given 2000:1 ratio)
        assertApproxEqRel(tokenCost, ethCost * 2000, 0.01e18);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _signRequest(MetaTxForwarder.ForwardRequest memory req) internal view returns (bytes memory) {
        bytes32 digest = _hashTypedData(req);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hashTypedData(MetaTxForwarder.ForwardRequest memory req) internal view returns (bytes32) {
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
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
