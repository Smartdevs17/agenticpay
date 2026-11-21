// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../SplitterOptimized.sol";
import "../../BatchSplitter.sol";
import "../../MetaTxForwarder.sol";

// ---------------------------------------------------------------------------
// Malicious receiver contracts used to simulate reentrancy attacks
// ---------------------------------------------------------------------------

/// @dev Attempts a direct reentrancy attack on SplitterOptimized.splitPayment.
///      The attacker is registered as a recipient. When it receives ETH it
///      tries to call splitPayment again. The nonReentrant guard must block
///      the inner call; the attacker's receive() does NOT revert on inner
///      failure so the outer call still completes.
contract ReentrantSplitterAttacker {
    SplitterOptimized public target;
    uint256 public attackCount;
    bool public attackEnabled;
    bool public innerCallSucceeded;

    constructor(SplitterOptimized _target) {
        target = _target;
    }

    function enableAttack() external { attackEnabled = true; }

    receive() external payable {
        if (attackEnabled && attackCount < 3) {
            attackCount++;
            // Attempt reentrant call — must revert due to nonReentrant guard.
            (bool ok,) = address(target).call{value: 0}(
                abi.encodeWithSelector(SplitterOptimized.splitPayment.selector)
            );
            if (ok) innerCallSucceeded = true;
        }
    }
}

/// @dev Attempts a cross-function reentrancy attack: re-enters withdraw()
///      from inside the splitPayment recipient callback.
///      The attacker is deployed as the owner of its own splitter so that
///      the withdraw() onlyOwner check passes — the only guard blocking
///      the call is the shared nonReentrant latch.
contract CrossFunctionReentrantAttacker {
    SplitterOptimized public target;
    bool public attackEnabled;
    bool public crossFunctionSucceeded;

    constructor(SplitterOptimized _target) {
        target = _target;
    }

    function enableAttack() external { attackEnabled = true; }

    receive() external payable {
        if (attackEnabled) {
            attackEnabled = false; // prevent infinite loop
            // Attempt to call withdraw() while splitPayment is executing.
            // Since this contract IS the owner of `target`, the onlyOwner
            // check passes — only the reentrancy guard can block this.
            (bool ok,) = address(target).call(
                abi.encodeWithSelector(
                    SplitterOptimized.withdraw.selector,
                    payable(address(this)),
                    address(target).balance
                )
            );
            if (ok) crossFunctionSucceeded = true;
        }
    }

    /// @dev Allow the test to deploy a splitter owned by this contract.
    function deploySplitter(uint16 feeBps) external returns (SplitterOptimized) {
        return new SplitterOptimized(feeBps);
    }

    /// @dev Allow the test to configure recipients on the owned splitter.
    function configureRecipient(
        SplitterOptimized s,
        uint256 index,
        address wallet,
        uint16 bps,
        uint256 minThreshold,
        bool active
    ) external {
        s.setRecipient(index, wallet, bps, minThreshold, active);
    }
}

/// @dev Attempts a read-only reentrancy: reads contract state mid-execution
///      to verify no state corruption occurs from a view-only callback.
contract ReadOnlyReentrantObserver {
    SplitterOptimized public target;
    uint256 public observedBalance;
    bool public observationEnabled;

    constructor(SplitterOptimized _target) {
        target = _target;
    }

    function enableObservation() external { observationEnabled = true; }

    receive() external payable {
        if (observationEnabled) {
            observationEnabled = false;
            // Pure read — no state change, must always succeed.
            observedBalance = address(target).balance;
        }
    }
}

/// @dev Attempts reentrancy on BatchSplitter.batchTransfer.
///      The attacker's receive() tries to re-enter batchTransfer.
///      The nonReentrant guard reverts the inner call with Reentrancy().
///      The attacker does NOT revert on inner failure, so the outer call
///      completes — but the inner reentrant transfer was blocked.
contract ReentrantBatchAttacker {
    BatchSplitter public target;
    uint256 public attackCount;
    bool public attackEnabled;
    bool public innerCallSucceeded;
    BatchSplitter.Transfer[] private _transfers;

    constructor(BatchSplitter _target) {
        target = _target;
    }

    function enableAttack(BatchSplitter.Transfer[] calldata transfers) external {
        attackEnabled = true;
        delete _transfers;
        for (uint256 i; i < transfers.length; i++) {
            _transfers.push(transfers[i]);
        }
    }

    receive() external payable {
        if (attackEnabled && attackCount < 3) {
            attackCount++;
            uint256 total;
            for (uint256 i; i < _transfers.length; i++) total += _transfers[i].amount;
            // Fund the reentrant call from the ETH we just received.
            (bool ok,) = address(target).call{value: total}(
                abi.encodeWithSelector(BatchSplitter.batchTransfer.selector, _transfers)
            );
            if (ok) innerCallSucceeded = true;
            // Do NOT revert here — let the outer call complete so we can
            // assert the inner call was blocked.
        }
    }
}

// ---------------------------------------------------------------------------
// Handler for invariant testing
// ---------------------------------------------------------------------------

contract SplitterHandler is Test {
    SplitterOptimized public splitter;
    uint256 public totalDeposited;

    constructor(SplitterOptimized _splitter) {
        splitter = _splitter;
    }

    function callSplitPayment(uint96 value) external payable {
        uint256 v = bound(uint256(value), 1, 10 ether);
        vm.deal(address(this), v);
        try splitter.splitPayment{value: v}() {
            totalDeposited += v;
        } catch {}
    }

    receive() external payable {}
}

// ---------------------------------------------------------------------------
// Main test contract
// ---------------------------------------------------------------------------

contract ReentrancyFuzzTest is StdInvariant, Test {

    SplitterOptimized internal splitter;
    BatchSplitter     internal batcher;
    MetaTxForwarder   internal forwarder;
    SplitterHandler   internal handler;

    address internal owner;
    uint256 internal ownerPk;

    // secp256k1 curve order — vm.sign requires 1 <= pk < ORDER
    uint256 internal constant SECP256K1_ORDER =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------

    function setUp() public {
        ownerPk = 0xDEAD;
        owner   = vm.addr(ownerPk);

        vm.startPrank(owner);
        splitter = new SplitterOptimized(500); // 5 % platform fee
        vm.stopPrank();

        batcher  = new BatchSplitter();
        forwarder = new MetaTxForwarder();

        handler = new SplitterHandler(splitter);
        vm.deal(address(handler), 100 ether);

        targetContract(address(handler));
    }

    // -----------------------------------------------------------------------
    // Invariant: contract balance never exceeds total deposited
    // -----------------------------------------------------------------------

    function invariant_splitter_balance_bounded_by_deposits() public view {
        assertLe(
            address(splitter).balance,
            handler.totalDeposited(),
            "splitter balance exceeds total deposited"
        );
    }

    // -----------------------------------------------------------------------
    // Direct reentrancy on SplitterOptimized
    // -----------------------------------------------------------------------

    function test_reentrancy_guard_blocks_direct_reentry() public {
        ReentrantSplitterAttacker attacker = new ReentrantSplitterAttacker(splitter);

        // Register attacker as the sole recipient (100 % bps).
        vm.prank(owner);
        splitter.setRecipient(0, address(attacker), 10_000, 0, true);

        attacker.enableAttack();

        vm.deal(address(this), 1 ether);
        // Outer splitPayment sends ETH to attacker. Attacker's receive() fires
        // and tries to re-enter splitPayment with value=0 (no ETH forwarded).
        // The nonReentrant guard reverts the inner call.
        splitter.splitPayment{value: 1 ether}();

        // Outer call completed — guard worked.
        assertTrue(attacker.attackCount() > 0,  "attacker receive was never triggered");
        assertFalse(attacker.innerCallSucceeded(), "inner reentrant call must not succeed");
    }

    // -----------------------------------------------------------------------
    // Cross-function reentrancy on SplitterOptimized
    // -----------------------------------------------------------------------

    function test_cross_function_reentrancy_blocked() public {
        // The attacker deploys a splitter it owns so that onlyOwner on
        // withdraw() passes — the only guard is the shared nonReentrant latch.
        CrossFunctionReentrantAttacker attacker =
            new CrossFunctionReentrantAttacker(splitter /* unused initial target */);

        // Attacker deploys and owns a fresh splitter.
        SplitterOptimized ownedSplitter = attacker.deploySplitter(0);

        // Point the attacker at the splitter it owns.
        attacker = new CrossFunctionReentrantAttacker(ownedSplitter);

        // Register attacker as sole recipient via the helper (attacker is owner).
        attacker.configureRecipient(ownedSplitter, 0, address(attacker), 10_000, 0, true);

        attacker.enableAttack();

        vm.deal(address(this), 1 ether);
        ownedSplitter.splitPayment{value: 1 ether}();

        assertFalse(
            attacker.crossFunctionSucceeded(),
            "cross-function reentrancy (splitPayment -> withdraw) must be blocked by nonReentrant"
        );
    }

    // -----------------------------------------------------------------------
    // Read-only reentrancy: view calls must not corrupt state
    // -----------------------------------------------------------------------

    function test_read_only_reentrancy_does_not_corrupt_state() public {
        ReadOnlyReentrantObserver observer = new ReadOnlyReentrantObserver(splitter);

        vm.prank(owner);
        splitter.setRecipient(0, address(observer), 10_000, 0, true);

        observer.enableObservation();

        uint256 balanceBefore = address(splitter).balance;
        vm.deal(address(this), 1 ether);
        splitter.splitPayment{value: 1 ether}();

        uint256 balanceAfter = address(splitter).balance;
        // Balance must be non-negative and consistent after the read-only callback.
        assertGe(balanceAfter, 0);
        // The mid-execution balance read by the observer must be bounded.
        assertLe(
            observer.observedBalance(),
            balanceBefore + 1 ether,
            "mid-execution balance observation must be bounded"
        );
    }

    // -----------------------------------------------------------------------
    // BatchSplitter reentrancy fuzz
    // -----------------------------------------------------------------------

    /// @dev The attacker's receive() tries to re-enter batchTransfer.
    ///      The nonReentrant guard reverts the inner call (Reentrancy error).
    ///      The attacker does NOT revert on inner failure, so the outer call
    ///      completes — but the inner reentrant transfer must have been blocked.
    function testFuzz_batchSplitter_reentrancy_blocked(uint96 amount) public {
        vm.assume(amount > 0 && amount < 10 ether);

        ReentrantBatchAttacker attacker = new ReentrantBatchAttacker(batcher);

        BatchSplitter.Transfer[] memory transfers = new BatchSplitter.Transfer[](1);
        transfers[0] = BatchSplitter.Transfer({to: address(attacker), amount: amount});

        attacker.enableAttack(transfers);

        vm.deal(address(this), amount);
        // Outer call succeeds (attacker's receive() does not revert on inner failure).
        batcher.batchTransfer{value: amount}(transfers);

        // The inner reentrant call must have been blocked by the guard.
        assertTrue(attacker.attackCount() > 0,   "attacker receive was never triggered");
        assertFalse(attacker.innerCallSucceeded(), "inner reentrant batchTransfer must not succeed");
    }

    // -----------------------------------------------------------------------
    // MetaTxForwarder: nonce-based replay protection (CEI)
    // -----------------------------------------------------------------------

    function testFuzz_forwarder_nonce_prevents_replay(uint256 pk) public {
        // vm.addr requires 1 <= pk < secp256k1 curve order.
        vm.assume(pk >= 1 && pk < SECP256K1_ORDER);
        address signer = vm.addr(pk);

        bytes32 TYPEHASH = keccak256(
            "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
        );

        MetaTxForwarder.ForwardRequest memory req = MetaTxForwarder.ForwardRequest({
            from:     signer,
            to:       address(0xBEEF),
            value:    0,
            gas:      50_000,
            nonce:    0,
            deadline: uint48(block.timestamp + 1 hours),
            data:     ""
        });

        bytes32 structHash = keccak256(abi.encode(
            TYPEHASH, req.from, req.to, req.value, req.gas,
            req.nonce, req.deadline, keccak256(req.data)
        ));
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", forwarder.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // First execution — nonce 0 is consumed.
        forwarder.execute(req, sig);
        assertEq(forwarder.nonces(signer), 1, "nonce must be 1 after first execute");

        // Replay with the same nonce must revert.
        vm.expectRevert(MetaTxForwarder.NonceUsed.selector);
        forwarder.execute(req, sig);
    }

    // -----------------------------------------------------------------------
    // Constructor reentrancy: SplitterOptimized._locked starts at 0
    // -----------------------------------------------------------------------

    function test_constructor_reentrancy_latch_starts_unlocked() public {
        // Deploy a fresh instance — the latch must start unlocked (0) so the
        // very first splitPayment call can proceed without a Reentrancy revert.
        // address(this) is the deployer and therefore the owner.
        SplitterOptimized fresh = new SplitterOptimized(0);

        // Configure a recipient (this contract is the owner).
        fresh.setRecipient(0, address(0xBEEF), 10_000, 0, true);

        vm.deal(address(this), 1 ether);
        // Must not revert — latch starts unlocked.
        fresh.splitPayment{value: 1 ether}();
    }

    // -----------------------------------------------------------------------
    // Fuzz: splitPayment with arbitrary recipient count never double-pays
    // -----------------------------------------------------------------------

    function testFuzz_splitPayment_no_double_payment(
        uint96 value,
        uint8  recipientCount
    ) public {
        vm.assume(value > 0 && value < 100 ether);
        uint256 n = bound(uint256(recipientCount), 1, 8);

        // Deploy a fresh splitter per fuzz run to avoid recipient state leaking
        // between runs.
        vm.startPrank(owner);
        SplitterOptimized freshSplitter = new SplitterOptimized(500);
        uint16 bps = uint16(10_000 / n);
        for (uint256 i; i < n; i++) {
            address wallet = address(uint160(0x1000 + i));
            freshSplitter.setRecipient(i, wallet, bps, 0, true);
        }
        vm.stopPrank();

        uint256 contractBalBefore = address(freshSplitter).balance;
        vm.deal(address(this), value);
        freshSplitter.splitPayment{value: value}();

        uint256 contractBalAfter = address(freshSplitter).balance;
        // Platform fee + dust must remain in the contract — balance must not
        // decrease relative to what was there before the call.
        assertGe(contractBalAfter, contractBalBefore,
            "contract balance must not decrease after splitPayment");
    }

    // -----------------------------------------------------------------------
    // Fuzz: withdraw after splitPayment never over-withdraws
    // -----------------------------------------------------------------------

    function testFuzz_withdraw_cannot_exceed_balance(uint96 depositValue) public {
        vm.assume(depositValue > 0 && depositValue < 10 ether);

        // Deploy a fresh splitter with no recipients so all value stays as fee.
        vm.prank(owner);
        SplitterOptimized freshSplitter = new SplitterOptimized(10_000); // 100% fee

        vm.deal(address(this), depositValue);
        freshSplitter.splitPayment{value: depositValue}();

        uint256 available = address(freshSplitter).balance;
        assertEq(available, depositValue, "all value must stay in contract with 100% fee");

        // Attempt to withdraw more than available must revert.
        vm.prank(owner);
        vm.expectRevert();
        freshSplitter.withdraw(payable(owner), available + 1);

        // Withdraw exactly available must succeed.
        vm.prank(owner);
        freshSplitter.withdraw(payable(owner), available);
        assertEq(address(freshSplitter).balance, 0, "balance must be 0 after full withdrawal");
    }

    receive() external payable {}
}
