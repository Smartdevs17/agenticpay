// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TimelockController
/// @notice Governance-controlled upgrade mechanism with configurable timelock delay
///         and multi-sig approval. Proposals must wait a minimum delay before execution.
/// @dev Compatible with the existing UpgradeableProxy contract. The timelock
///      itself must be set as the proxy admin (or ProxyAdmin operator) to gate upgrades.
contract TimelockController {
    // ── Enums ────────────────────────────────────────────────────────────────

    enum ProposalStatus { Pending, Approved, Executed, Cancelled }

    // ── Structs ──────────────────────────────────────────────────────────────

    struct Proposal {
        address target;           // Proxy contract to upgrade
        address newImplementation; // New implementation address
        bytes data;               // Optional call data for upgradeToAndCall
        uint256 eta;              // Earliest execution timestamp (scheduledAt + delay)
        uint256 scheduledAt;
        uint256 executedAt;
        uint256 approvalCount;
        ProposalStatus status;
    }

    // ── State ────────────────────────────────────────────────────────────────

    uint256 public constant MIN_DELAY = 48 hours;

    uint256 public delay;
    uint256 public approvalThreshold;

    address public admin;
    mapping(address => bool) public proposers;
    mapping(address => bool) public approvers;
    mapping(bytes32 => bool) public hasApproved; // proposalId => approver => approved

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    // ── Events ───────────────────────────────────────────────────────────────

    event ProposalScheduled(
        uint256 indexed proposalId,
        address indexed target,
        address indexed newImplementation,
        uint256 eta
    );
    event ProposalApproved(uint256 indexed proposalId, address indexed approver);
    event ProposalExecuted(uint256 indexed proposalId, address indexed target);
    event ProposalCancelled(uint256 indexed proposalId);
    event DelayUpdated(uint256 oldDelay, uint256 newDelay);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event ProposerUpdated(address indexed proposer, bool active);
    event ApproverUpdated(address indexed approver, bool active);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotAdmin();
    error NotProposer();
    error NotApprover();
    error DelayTooShort();
    error ZeroAddress();
    error ProposalNotFound();
    error NotReady();
    error AlreadyApproved();
    error InsufficientApprovals();
    error InvalidStatus();
    error AlreadyExecuted();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyProposer() {
        if (!proposers[msg.sender] && msg.sender != admin) revert NotProposer();
        _;
    }

    modifier onlyApprover() {
        if (!approvers[msg.sender]) revert NotApprover();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        uint256 _delay,
        uint256 _approvalThreshold,
        address[] memory _proposers,
        address[] memory _approvers
    ) {
        if (_delay < MIN_DELAY) revert DelayTooShort();
        delay = _delay;
        approvalThreshold = _approvalThreshold;
        admin = msg.sender;

        for (uint256 i; i < _proposers.length; ) {
            proposers[_proposers[i]] = true;
            unchecked { ++i; }
        }
        for (uint256 i; i < _approvers.length; ) {
            approvers[_approvers[i]] = true;
            unchecked { ++i; }
        }
    }

    // ── Proposal Lifecycle ───────────────────────────────────────────────────

    /// @notice Schedule a new upgrade proposal.
    function schedule(
        address target,
        address newImplementation,
        bytes calldata data
    ) external onlyProposer returns (uint256 proposalId) {
        if (target == address(0) || newImplementation == address(0)) revert ZeroAddress();

        proposalId = proposalCount++;
        uint256 eta = block.timestamp + delay;

        proposals[proposalId] = Proposal({
            target: target,
            newImplementation: newImplementation,
            data: data,
            eta: eta,
            scheduledAt: block.timestamp,
            executedAt: 0,
            approvalCount: 0,
            status: ProposalStatus.Pending
        });

        emit ProposalScheduled(proposalId, target, newImplementation, eta);
    }

    /// @notice Approve a pending proposal.
    function approve(uint256 proposalId) external onlyApprover {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Pending) revert InvalidStatus();

        bytes32 approvalKey = keccak256(abi.encode(proposalId, msg.sender));
        if (hasApproved[approvalKey]) revert AlreadyApproved();

        hasApproved[approvalKey] = true;
        p.approvalCount++;

        if (p.approvalCount >= approvalThreshold) {
            p.status = ProposalStatus.Approved;
        }

        emit ProposalApproved(proposalId, msg.sender);
    }

    /// @notice Execute an approved proposal after the timelock delay.
    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Approved) revert InsufficientApprovals();
        if (block.timestamp < p.eta) revert NotReady();
        if (p.executedAt != 0) revert AlreadyExecuted();

        p.status = ProposalStatus.Executed;
        p.executedAt = block.timestamp;

        // Call the proxy's upgradeTo (or upgradeToAndCall if data provided)
        if (p.data.length > 0) {
            (bool ok, ) = p.target.call(
                abi.encodeWithSignature("upgradeTo(address)", p.newImplementation)
            );
            require(ok, "Upgrade call failed");
            // If additional data call is needed, execute separately
            (bool ok2, ) = p.target.call(p.data);
            require(ok2, "Data call failed");
        } else {
            (bool ok, ) = p.target.call(
                abi.encodeWithSignature("upgradeTo(address)", p.newImplementation)
            );
            require(ok, "Upgrade call failed");
        }

        emit ProposalExecuted(proposalId, p.target);
    }

    /// @notice Cancel a pending or approved proposal (admin only or proposer).
    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.status == ProposalStatus.Executed) revert AlreadyExecuted();
        if (p.status == ProposalStatus.Cancelled) revert InvalidStatus();
        if (msg.sender != admin && !proposers[msg.sender]) revert NotProposer();

        p.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(proposalId);
    }

    // ── Admin Configuration ──────────────────────────────────────────────────

    function setDelay(uint256 newDelay) external onlyAdmin {
        if (newDelay < MIN_DELAY) revert DelayTooShort();
        uint256 oldDelay = delay;
        delay = newDelay;
        emit DelayUpdated(oldDelay, newDelay);
    }

    function setThreshold(uint256 newThreshold) external onlyAdmin {
        uint256 oldThreshold = approvalThreshold;
        approvalThreshold = newThreshold;
        emit ThresholdUpdated(oldThreshold, newThreshold);
    }

    function setProposer(address proposer, bool active) external onlyAdmin {
        if (proposer == address(0)) revert ZeroAddress();
        proposers[proposer] = active;
        emit ProposerUpdated(proposer, active);
    }

    function setApprover(address approver, bool active) external onlyAdmin {
        if (approver == address(0)) revert ZeroAddress();
        approvers[approver] = active;
        emit ApproverUpdated(approver, active);
    }

    // ── View Helpers ─────────────────────────────────────────────────────────

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function isReady(uint256 proposalId) external view returns (bool) {
        Proposal storage p = proposals[proposalId];
        return p.status == ProposalStatus.Approved && block.timestamp >= p.eta;
    }
}
