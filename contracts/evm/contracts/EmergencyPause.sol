// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EmergencyPause
/// @notice Guardian multi-sig pause mechanism for critical fixes.
///         When activated, the target proxy's implementation is swapped to a
///         "paused" stub that reverts all calls. Auto-expires after MAX_PAUSE_DURATION.
contract EmergencyPause {
    // ── Constants ────────────────────────────────────────────────────────────

    /// @notice Maximum pause duration (7 days). After this the pause auto-expires.
    uint256 public constant MAX_PAUSE_DURATION = 7 days;

    /// @notice Minimum number of guardian approvals required to activate pause.
    uint256 public immutable threshold;

    // ── State ────────────────────────────────────────────────────────────────

    address public admin;
    mapping(address => bool) public guardians;

    struct PauseRecord {
        address proxy;
        address previousImplementation;
        address pauseImplementation;
        uint256 activatedAt;
        uint256 expiresAt;
        bool active;
        uint256 approvalCount;
    }

    uint256 public pauseCount;
    mapping(uint256 => PauseRecord) public pauseRecords;

    // Approval tracking: pauseId => guardian => approved
    mapping(uint256 => mapping(address => bool)) public hasGuardianApproved;

    // ── Events ───────────────────────────────────────────────────────────────

    event PauseRequested(uint256 indexed pauseId, address indexed proxy, address requester);
    event PauseApproved(uint256 indexed pauseId, address indexed guardian);
    event PauseActivated(uint256 indexed pauseId, address indexed proxy, uint256 expiresAt);
    event PauseResumed(uint256 indexed pauseId, address indexed proxy);
    event PauseExpired(uint256 indexed pauseId, address indexed proxy);
    event GuardianUpdated(address indexed guardian, bool active);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotAdmin();
    error NotGuardian();
    error ZeroAddress();
    error PauseNotFound();
    error AlreadyApproved();
    error InsufficientApprovals();
    error PauseNotActive();
    error PauseStillActive();
    error PauseAlreadyExpired();
    error NotEligibleForResume();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyGuardian() {
        if (!guardians[msg.sender]) revert NotGuardian();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(uint256 _threshold, address[] memory _guardians) {
        threshold = _threshold;
        admin = msg.sender;
        for (uint256 i; i < _guardians.length; ) {
            guardians[_guardians[i]] = true;
            unchecked { ++i; }
        }
    }

    // ── Pause Lifecycle ──────────────────────────────────────────────────────

    /// @notice Request an emergency pause for a proxy.
    /// @param proxy The proxy contract to pause.
    /// @param pauseImplementation Address of the "paused" stub implementation.
    /// @return pauseId The ID of the pause request.
    function requestPause(
        address proxy,
        address pauseImplementation
    ) external onlyGuardian returns (uint256 pauseId) {
        if (proxy == address(0) || pauseImplementation == address(0)) revert ZeroAddress();

        pauseId = pauseCount++;

        // Read current implementation from proxy EIP-1967 slot
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        address currentImpl;
        // Note: We can't read proxy storage directly, so caller must track the previous impl.
        // For safety, store address(0) and let activatePause set the real previous impl.
        currentImpl = address(0);

        pauseRecords[pauseId] = PauseRecord({
            proxy: proxy,
            previousImplementation: currentImpl,
            pauseImplementation: pauseImplementation,
            activatedAt: 0,
            expiresAt: 0,
            active: false,
            approvalCount: 1 // requester auto-approves
        });
        hasGuardianApproved[pauseId][msg.sender] = true;

        emit PauseRequested(pauseId, proxy, msg.sender);

        if (pauseRecords[pauseId].approvalCount >= threshold) {
            _activatePause(pauseId, currentImpl);
        }
    }

    /// @notice A guardian approves a pending pause request.
    function approvePause(uint256 pauseId, address previousImplementation) external onlyGuardian {
        PauseRecord storage pr = pauseRecords[pauseId];
        if (pr.proxy == address(0)) revert PauseNotFound();
        if (hasGuardianApproved[pauseId][msg.sender]) revert AlreadyApproved();

        hasGuardianApproved[pauseId][msg.sender] = true;
        pr.approvalCount++;

        // Store the real previous implementation if not yet set
        if (pr.previousImplementation == address(0) && previousImplementation != address(0)) {
            pr.previousImplementation = previousImplementation;
        }

        emit PauseApproved(pauseId, msg.sender);

        if (pr.approvalCount >= threshold && !pr.active) {
            _activatePause(pauseId, pr.previousImplementation);
        }
    }

    /// @notice Resume (unpause) a proxy after emergency is resolved.
    function resume(uint256 pauseId) external onlyAdmin {
        PauseRecord storage pr = pauseRecords[pauseId];
        if (pr.proxy == address(0)) revert PauseNotFound();
        if (!pr.active) revert PauseNotActive();

        // Check if expired
        if (block.timestamp >= pr.expiresAt) {
            pr.active = false;
            emit PauseExpired(pauseId, pr.proxy);
        }

        // Swap back to the previous implementation
        (bool ok, ) = pr.proxy.call(
            abi.encodeWithSignature("upgradeTo(address)", pr.previousImplementation)
        );
        require(ok, "Resume upgrade failed");

        pr.active = false;
        emit PauseResumed(pauseId, pr.proxy);
    }

    /// @notice Check and mark expired pauses.
    function checkExpired(uint256 pauseId) external {
        PauseRecord storage pr = pauseRecords[pauseId];
        if (!pr.active) revert PauseNotActive();
        if (block.timestamp < pr.expiresAt) revert PauseAlreadyExpired();

        pr.active = false;
        emit PauseExpired(pauseId, pr.proxy);
    }

    // ── Admin Configuration ──────────────────────────────────────────────────

    function setGuardian(address guardian, bool active) external onlyAdmin {
        if (guardian == address(0)) revert ZeroAddress();
        guardians[guardian] = active;
        emit GuardianUpdated(guardian, active);
    }

    // ── View Helpers ─────────────────────────────────────────────────────────

    function getPauseRecord(uint256 pauseId) external view returns (PauseRecord memory) {
        return pauseRecords[pauseId];
    }

    function isPauseActive(uint256 pauseId) external view returns (bool) {
        PauseRecord storage pr = pauseRecords[pauseId];
        if (!pr.active) return false;
        return block.timestamp < pr.expiresAt;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _activatePause(uint256 pauseId, address previousImpl) internal {
        PauseRecord storage pr = pauseRecords[pauseId];
        pr.active = true;
        pr.activatedAt = block.timestamp;
        pr.expiresAt = block.timestamp + MAX_PAUSE_DURATION;
        if (pr.previousImplementation == address(0)) {
            pr.previousImplementation = previousImpl;
        }

        // Upgrade proxy to the pause stub
        (bool ok, ) = pr.proxy.call(
            abi.encodeWithSignature("upgradeTo(address)", pr.pauseImplementation)
        );
        require(ok, "Pause upgrade failed");

        emit PauseActivated(pauseId, pr.proxy, pr.expiresAt);
    }
}
