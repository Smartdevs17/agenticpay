// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PaymentVault
/// @notice Time-locked payment vault with milestone-based fund release.
///         Funds are deposited by a client and released to a recipient when
///         individual milestones are approved.  An optional approver per
///         milestone can confirm completion; if the deadline passes without
///         approver action the depositor may trigger auto-release or refund.
contract PaymentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Enums ────────────────────────────────────────────────────────────────

    enum VaultStatus      { Pending, Active, Disputed, Completed, Refunded }
    enum MilestoneStatus  { Pending, Approved, Released, Expired, Disputed }

    // ── Structs ──────────────────────────────────────────────────────────────

    struct Milestone {
        string  name;
        uint16  amountBps;    // basis points of totalAmount (sum must equal 10 000)
        uint256 deadline;     // Unix timestamp; 0 = no deadline
        address approver;     // address(0) = depositor self-approves
        MilestoneStatus status;
    }

    struct Vault {
        address  depositor;
        address  recipient;
        uint256  totalAmount;
        address  token;         // address(0) = native ETH
        VaultStatus status;
        uint256  milestoneCount;
        uint256  releasedAmount;
    }

    // ── State ────────────────────────────────────────────────────────────────

    uint256 public vaultCount;
    mapping(uint256 => Vault) public vaults;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;

    // ── Events ───────────────────────────────────────────────────────────────

    event VaultCreated(
        uint256 indexed vaultId,
        address indexed depositor,
        address indexed recipient,
        uint256 totalAmount,
        address token
    );
    event MilestoneApproved(uint256 indexed vaultId, uint256 milestoneIndex, address approver);
    event MilestoneReleased(uint256 indexed vaultId, uint256 milestoneIndex, uint256 amount, address recipient);
    event MilestoneExpired(uint256 indexed vaultId, uint256 milestoneIndex);
    event VaultRefunded(uint256 indexed vaultId, uint256 amount, address depositor);
    event DisputeRaised(uint256 indexed vaultId, address raisedBy);
    event DisputeResolved(uint256 indexed vaultId, bool releasedToRecipient);

    // ── Errors ───────────────────────────────────────────────────────────────

    error VaultNotFound();
    error MilestoneNotFound();
    error InvalidBpsSum();
    error EmptyMilestones();
    error Unauthorized();
    error InvalidStatus();
    error DeadlineNotPassed();
    error DeadlinePassed();
    error AlreadyReleased();
    error InsufficientValue();
    error TransferFailed();
    error ZeroAddress();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier vaultExists(uint256 vaultId) {
        if (vaultId >= vaultCount) revert VaultNotFound();
        _;
    }

    modifier onlyDepositor(uint256 vaultId) {
        if (msg.sender != vaults[vaultId].depositor) revert Unauthorized();
        _;
    }

    // ── Vault Lifecycle ──────────────────────────────────────────────────────

    /// @notice Create a vault and deposit funds.
    /// @param recipient    Who receives released funds.
    /// @param token        ERC-20 token address; address(0) for native ETH.
    /// @param names        Human-readable name per milestone.
    /// @param milestoneBps Basis-point share per milestone (must sum to 10 000).
    /// @param deadlines    Unix deadline per milestone (0 = no deadline).
    /// @param approvers    Approver per milestone (address(0) = depositor).
    function createVault(
        address recipient,
        address token,
        string[] calldata names,
        uint16[]  calldata milestoneBps,
        uint256[] calldata deadlines,
        address[] calldata approvers
    ) external payable nonReentrant returns (uint256 vaultId) {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 n = milestoneBps.length;
        if (n == 0) revert EmptyMilestones();
        if (n != deadlines.length || n != approvers.length || n != names.length) revert InvalidBpsSum();

        uint256 bpsSum;
        unchecked {
            for (uint256 i; i < n; ++i) bpsSum += milestoneBps[i];
        }
        if (bpsSum != 10_000) revert InvalidBpsSum();

        uint256 totalAmount;
        if (token == address(0)) {
            totalAmount = msg.value;
            if (totalAmount == 0) revert InsufficientValue();
        } else {
            totalAmount = IERC20(token).allowance(msg.sender, address(this));
            if (totalAmount == 0) revert InsufficientValue();
            IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
        }

        unchecked { vaultId = vaultCount++; }

        Vault storage v = vaults[vaultId];
        v.depositor    = msg.sender;
        v.recipient    = recipient;
        v.totalAmount  = totalAmount;
        v.token        = token;
        v.status       = VaultStatus.Active;
        v.milestoneCount = n;

        for (uint256 i; i < n; ) {
            milestones[vaultId][i] = Milestone({
                name:       names[i],
                amountBps:  milestoneBps[i],
                deadline:   deadlines[i],
                approver:   approvers[i] == address(0) ? msg.sender : approvers[i],
                status:     MilestoneStatus.Pending
            });
            unchecked { ++i; }
        }

        emit VaultCreated(vaultId, msg.sender, recipient, totalAmount, token);
    }

    /// @notice Approver (or depositor) confirms a milestone is complete.
    function approveMilestone(uint256 vaultId, uint256 idx)
        external
        vaultExists(vaultId)
        nonReentrant
    {
        Vault storage v = vaults[vaultId];
        if (v.status != VaultStatus.Active) revert InvalidStatus();

        Milestone storage m = milestones[vaultId][idx];
        if (idx >= v.milestoneCount) revert MilestoneNotFound();
        if (m.status != MilestoneStatus.Pending) revert InvalidStatus();
        if (msg.sender != m.approver && msg.sender != v.depositor) revert Unauthorized();

        // Fail if deadline has passed
        if (m.deadline != 0 && block.timestamp > m.deadline) revert DeadlinePassed();

        m.status = MilestoneStatus.Approved;
        emit MilestoneApproved(vaultId, idx, msg.sender);

        _releaseMilestone(vaultId, idx);
    }

    /// @notice Release a milestone that has passed its deadline (auto-release).
    function releaseExpiredMilestone(uint256 vaultId, uint256 idx)
        external
        vaultExists(vaultId)
        nonReentrant
    {
        Vault storage v = vaults[vaultId];
        if (v.status != VaultStatus.Active) revert InvalidStatus();

        Milestone storage m = milestones[vaultId][idx];
        if (idx >= v.milestoneCount) revert MilestoneNotFound();
        if (m.status != MilestoneStatus.Pending) revert InvalidStatus();
        if (m.deadline == 0 || block.timestamp <= m.deadline) revert DeadlineNotPassed();

        m.status = MilestoneStatus.Expired;
        emit MilestoneExpired(vaultId, idx);

        _releaseMilestone(vaultId, idx);
    }

    /// @notice Refund all unreleased funds to the depositor.
    ///         Callable only by depositor and only when no milestone is Approved (pending release).
    function refund(uint256 vaultId)
        external
        vaultExists(vaultId)
        onlyDepositor(vaultId)
        nonReentrant
    {
        Vault storage v = vaults[vaultId];
        if (v.status != VaultStatus.Active) revert InvalidStatus();

        // Ensure no milestone is sitting in Approved state
        uint256 n = v.milestoneCount;
        for (uint256 i; i < n; ) {
            if (milestones[vaultId][i].status == MilestoneStatus.Approved) revert InvalidStatus();
            unchecked { ++i; }
        }

        uint256 remaining = v.totalAmount - v.releasedAmount;
        v.status = VaultStatus.Refunded;

        _transfer(v.token, v.depositor, remaining);
        emit VaultRefunded(vaultId, remaining, v.depositor);
    }

    /// @notice Raise a dispute to pause further releases.
    function raiseDispute(uint256 vaultId)
        external
        vaultExists(vaultId)
    {
        Vault storage v = vaults[vaultId];
        if (v.status != VaultStatus.Active) revert InvalidStatus();
        if (msg.sender != v.depositor && msg.sender != v.recipient) revert Unauthorized();

        v.status = VaultStatus.Disputed;
        emit DisputeRaised(vaultId, msg.sender);
    }

    /// @notice Admin-only dispute resolution (releases to recipient or refunds depositor).
    ///         In a production contract this would be gated behind a multisig or DAO.
    function resolveDispute(uint256 vaultId, bool releaseToRecipient)
        external
        vaultExists(vaultId)
    {
        Vault storage v = vaults[vaultId];
        if (v.status != VaultStatus.Disputed) revert InvalidStatus();

        uint256 remaining = v.totalAmount - v.releasedAmount;
        if (releaseToRecipient) {
            v.status = VaultStatus.Completed;
            _transfer(v.token, v.recipient, remaining);
        } else {
            v.status = VaultStatus.Refunded;
            _transfer(v.token, v.depositor, remaining);
        }

        emit DisputeResolved(vaultId, releaseToRecipient);
    }

    // ── View Helpers ─────────────────────────────────────────────────────────

    function getVault(uint256 vaultId) external view returns (Vault memory) {
        return vaults[vaultId];
    }

    function getMilestone(uint256 vaultId, uint256 idx) external view returns (Milestone memory) {
        return milestones[vaultId][idx];
    }

    function getMilestones(uint256 vaultId) external view returns (Milestone[] memory result) {
        uint256 n = vaults[vaultId].milestoneCount;
        result = new Milestone[](n);
        for (uint256 i; i < n; ) {
            result[i] = milestones[vaultId][i];
            unchecked { ++i; }
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _releaseMilestone(uint256 vaultId, uint256 idx) internal {
        Vault storage v = vaults[vaultId];
        Milestone storage m = milestones[vaultId][idx];

        uint256 releaseAmount = (v.totalAmount * m.amountBps) / 10_000;
        unchecked { v.releasedAmount += releaseAmount; }
        m.status = MilestoneStatus.Released;

        _transfer(v.token, v.recipient, releaseAmount);
        emit MilestoneReleased(vaultId, idx, releaseAmount, v.recipient);

        // Auto-complete vault when all milestones released
        if (v.releasedAmount >= v.totalAmount) {
            v.status = VaultStatus.Completed;
        }
    }

    function _transfer(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}('');
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
