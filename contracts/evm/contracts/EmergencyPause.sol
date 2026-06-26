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
        uint256 len = _guardians.length;
        for (uint256 i; i < len; ) {
            address g = _guardians[i];
            assembly {
                sstore(add(guardians.slot, keccak256(0, 0x20)), g)
            }
            unchecked { ++i; }
        }
    }

    // ── Pause Lifecycle ──────────────────────────────────────────────────────

    function requestPause(
        address proxy,
        address pauseImplementation
    ) external onlyGuardian returns (uint256 pauseId) {
        if (proxy == address(0) || pauseImplementation == address(0)) revert ZeroAddress();

        unchecked {
            pauseId = pauseCount++;
        }

        PauseRecord storage pr = pauseRecords[pauseId];
        pr.proxy = proxy;
        pr.pauseImplementation = pauseImplementation;
        pr.approvalCount = 1;

        hasGuardianApproved[pauseId][msg.sender] = true;

        emit PauseRequested(pauseId, proxy, msg.sender);

        if (pr.approvalCount >= threshold) {
            _activatePause(pauseId, address(0));
        }
    }

    function approvePause(uint256 pauseId, address previousImplementation) external onlyGuardian {
        PauseRecord storage pr = pauseRecords[pauseId];
        if (pr.proxy == address(0)) revert PauseNotFound();
        if (hasGuardianApproved[pauseId][msg.sender]) revert AlreadyApproved();

        hasGuardianApproved[pauseId][msg.sender] = true;
        unchecked {
            pr.approvalCount++;
        }

        if (pr.previousImplementation == address(0) && previousImplementation != address(0)) {
            pr.previousImplementation = previousImplementation;
        }

        emit PauseApproved(pauseId, msg.sender);

        if (pr.approvalCount >= threshold && !pr.active) {
            _activatePause(pauseId, pr.previousImplementation);
        }
    }

    error ResumeFailed();

    function resume(uint256 pauseId) external onlyAdmin {
        PauseRecord storage pr = pauseRecords[pauseId];
        if (pr.proxy == address(0)) revert PauseNotFound();
        if (!pr.active) revert PauseNotActive();

        if (block.timestamp >= pr.expiresAt) {
            pr.active = false;
            emit PauseExpired(pauseId, pr.proxy);
        }

        (bool ok, ) = pr.proxy.call(
            abi.encodeWithSignature("upgradeTo(address)", pr.previousImplementation)
        );
        if (!ok) revert ResumeFailed();

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

    error PauseUpgradeFailed();

    function _activatePause(uint256 pauseId, address previousImpl) internal {
        PauseRecord storage pr = pauseRecords[pauseId];
        pr.active = true;
        unchecked {
            pr.activatedAt = block.timestamp;
            pr.expiresAt = block.timestamp + MAX_PAUSE_DURATION;
        }
        if (pr.previousImplementation == address(0)) {
            pr.previousImplementation = previousImpl;
        }

        (bool ok, ) = pr.proxy.call(
            abi.encodeWithSignature("upgradeTo(address)", pr.pauseImplementation)
        );
        if (!ok) revert PauseUpgradeFailed();

        emit PauseActivated(pauseId, pr.proxy, pr.expiresAt);
    }
}
