// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../evm/contracts/TimelockController.sol";
import "../../evm/contracts/EmergencyPause.sol";
import "../../UpgradeableProxy.sol";

/// @notice Mock implementation contract for testing upgrades
contract MockImplV1 {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
    function version() external pure returns (string memory) { return "v1"; }
}

contract MockImplV2 {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
    function version() external pure returns (string memory) { return "v2"; }
    function getValue() external view returns (uint256) { return value; }
}

/// @notice Stub implementation that reverts all calls (for EmergencyPause)
contract PausedImpl {
    error ContractPaused();
    fallback() external payable { revert ContractPaused(); }
    receive() external payable { revert ContractPaused(); }
}

contract TimelockUpgradeTest is Test {
    TimelockController timelock;
    UpgradeableProxy proxy;
    MockImplV1 implV1;
    MockImplV2 implV2;
    PausedImpl pausedImpl;
    EmergencyPause emergencyPause;

    address admin = address(this);
    address proposer = address(0x1);
    address approver1 = address(0x2);
    address approver2 = address(0x3);
    address approver3 = address(0x4);
    address guardian1 = address(0x10);
    address guardian2 = address(0x11);

    uint256 constant DELAY = 48 hours;

    function setUp() public {
        // Deploy implementation contracts
        implV1 = new MockImplV1();
        implV2 = new MockImplV2();
        pausedImpl = new PausedImpl();

        // Deploy proxy pointing to V1, with admin being this test contract initially
        proxy = new UpgradeableProxy(address(implV1), admin);

        // Deploy timelock with 48h delay, threshold of 2 approvers
        address[] memory proposers_ = new address[](1);
        proposers_[0] = proposer;
        address[] memory approvers_ = new address[](3);
        approvers_[0] = approver1;
        approvers_[1] = approver2;
        approvers_[2] = approver3;
        timelock = new TimelockController(DELAY, 2, proposers_, approvers_);

        // Transfer proxy admin to timelock
        proxy.changeAdmin(address(timelock));

        // Deploy emergency pause with threshold 2
        address[] memory guardians_ = new address[](2);
        guardians_[0] = guardian1;
        guardians_[1] = guardian2;
        emergencyPause = new EmergencyPause(2, guardians_);
    }

    // ── Timelock: Schedule and Execute ───────────────────────────────────────

    function test_scheduleAndExecuteUpgrade() public {
        // Schedule proposal
        vm.prank(proposer);
        uint256 pid = timelock.schedule(address(proxy), address(implV2), "");

        // Verify proposal is pending
        TimelockController.Proposal memory p = timelock.getProposal(pid);
        assertEq(uint256(p.status), uint256(TimelockController.ProposalStatus.Pending));

        // Approve with 2 approvers (meets threshold)
        vm.prank(approver1);
        timelock.approve(pid);
        vm.prank(approver2);
        timelock.approve(pid);

        // Verify proposal is approved
        p = timelock.getProposal(pid);
        assertEq(uint256(p.status), uint256(TimelockController.ProposalStatus.Approved));

        // Warp past timelock delay
        vm.warp(block.timestamp + DELAY + 1);

        // Execute
        timelock.execute(pid);

        // Verify upgrade happened
        p = timelock.getProposal(pid);
        assertEq(uint256(p.status), uint256(TimelockController.ProposalStatus.Executed));
    }

    // ── Timelock: Cannot Execute Before Delay ────────────────────────────────

    function test_cannotExecuteBeforeDelay() public {
        vm.prank(proposer);
        uint256 pid = timelock.schedule(address(proxy), address(implV2), "");

        vm.prank(approver1);
        timelock.approve(pid);
        vm.prank(approver2);
        timelock.approve(pid);

        // Try to execute before delay passes
        vm.expectRevert(TimelockController.NotReady.selector);
        timelock.execute(pid);
    }

    // ── Timelock: Cannot Execute Without Approvals ───────────────────────────

    function test_cannotExecuteWithoutApprovals() public {
        vm.prank(proposer);
        uint256 pid = timelock.schedule(address(proxy), address(implV2), "");

        // Only 1 approval (threshold is 2)
        vm.prank(approver1);
        timelock.approve(pid);

        vm.warp(block.timestamp + DELAY + 1);

        vm.expectRevert(TimelockController.InsufficientApprovals.selector);
        timelock.execute(pid);
    }

    // ── Timelock: Cancel Proposal ────────────────────────────────────────────

    function test_cancelProposal() public {
        vm.prank(proposer);
        uint256 pid = timelock.schedule(address(proxy), address(implV2), "");

        // Cancel as proposer
        vm.prank(proposer);
        timelock.cancel(pid);

        TimelockController.Proposal memory p = timelock.getProposal(pid);
        assertEq(uint256(p.status), uint256(TimelockController.ProposalStatus.Cancelled));
    }

    function test_cannotExecuteCancelledProposal() public {
        vm.prank(proposer);
        uint256 pid = timelock.schedule(address(proxy), address(implV2), "");

        vm.prank(approver1);
        timelock.approve(pid);
        vm.prank(approver2);
        timelock.approve(pid);

        vm.prank(admin);
        timelock.cancel(pid);

        vm.warp(block.timestamp + DELAY + 1);

        vm.expectRevert(TimelockController.InsufficientApprovals.selector);
        timelock.execute(pid);
    }

    // ── Timelock: Duplicate Approval Rejected ────────────────────────────────

    function test_cannotApproveTwice() public {
        vm.prank(proposer);
        uint256 pid = timelock.schedule(address(proxy), address(implV2), "");

        vm.prank(approver1);
        timelock.approve(pid);

        vm.prank(approver1);
        vm.expectRevert(TimelockController.AlreadyApproved.selector);
        timelock.approve(pid);
    }

    // ── Timelock: Configuration ──────────────────────────────────────────────

    function test_setDelay() public {
        uint256 newDelay = 72 hours;
        timelock.setDelay(newDelay);
        assertEq(timelock.delay(), newDelay);
    }

    function test_cannotSetDelayBelowMinimum() public {
        vm.expectRevert(TimelockController.DelayTooShort.selector);
        timelock.setDelay(1 hours);
    }

    function test_isReady() public {
        vm.prank(proposer);
        uint256 pid = timelock.schedule(address(proxy), address(implV2), "");

        vm.prank(approver1);
        timelock.approve(pid);
        vm.prank(approver2);
        timelock.approve(pid);

        assertFalse(timelock.isReady(pid));

        vm.warp(block.timestamp + DELAY + 1);
        assertTrue(timelock.isReady(pid));
    }

    // ── Emergency Pause ──────────────────────────────────────────────────────

    function test_emergencyPauseActivation() public {
        // Guardian 1 requests pause
        vm.prank(guardian1);
        uint256 pid = emergencyPause.requestPause(address(proxy), address(pausedImpl));

        // Guardian 2 approves (meets threshold of 2)
        vm.prank(guardian2);
        emergencyPause.approvePause(pid, address(implV1));

        // Verify pause is active
        assertTrue(emergencyPause.isPauseActive(pid));
    }

    function test_emergencyPauseResume() public {
        vm.prank(guardian1);
        uint256 pid = emergencyPause.requestPause(address(proxy), address(pausedImpl));

        vm.prank(guardian2);
        emergencyPause.approvePause(pid, address(implV1));

        // Admin resumes
        emergencyPause.resume(pid);

        assertFalse(emergencyPause.isPauseActive(pid));
    }

    function test_emergencyPauseAutoExpiry() public {
        vm.prank(guardian1);
        uint256 pid = emergencyPause.requestPause(address(proxy), address(pausedImpl));

        vm.prank(guardian2);
        emergencyPause.approvePause(pid, address(implV1));

        // Warp past max pause duration
        vm.warp(block.timestamp + emergencyPause.MAX_PAUSE_DURATION() + 1);

        // Check expired
        emergencyPause.checkExpired(pid);
        assertFalse(emergencyPause.isPauseActive(pid));
    }

    function test_nonGuardianCannotRequestPause() public {
        vm.prank(address(0x999));
        vm.expectRevert(EmergencyPause.NotGuardian.selector);
        emergencyPause.requestPause(address(proxy), address(pausedImpl));
    }
}
