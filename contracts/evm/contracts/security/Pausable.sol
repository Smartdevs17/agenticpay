// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Pausable
/// @notice Inheritable emergency pause mechanism with multi-sig governance,
///         automatic unpause timeout, and transparent audit logging.
///         EVM contracts inherit this and protect critical functions with
///         `whenNotPaused`. A single guardian can trigger an emergency pause,
///         but unpausing requires multi-sig approval or waiting for the
///         configurable timeout (max 72 hours).
abstract contract Pausable {
    // ── Constants ────────────────────────────────────────────────────────────
    uint256 public constant MAX_PAUSE_TIMEOUT = 72 hours;

    // ── State ────────────────────────────────────────────────────────────────
    bool private _paused;
    uint256 private _pausedAt;
    uint256 private _unpauseTimeout;

    address public pauseAdmin;
    address public pauseGuardian;

    uint256 public unpauseThreshold;
    mapping(address => bool) public unpauseSigners;
    address[] private _signerList;

    uint256 private _unpauseApprovalCount;
    mapping(address => bool) private _hasApprovedUnpause;

    // ── Events ───────────────────────────────────────────────────────────────
    event Paused(address indexed guardian, uint256 timestamp, uint256 unpauseTimeout);
    event Unpaused(address indexed actor, uint256 timestamp, string reason);
    event PauseProposed(address indexed guardian, uint256 timestamp);
    event PauseGuardianChanged(address indexed oldGuardian, address indexed newGuardian);
    event UnpauseApproved(address indexed signer, uint256 currentApprovals, uint256 threshold);
    event UnpauseSignerUpdated(address indexed signer, bool active);

    // ── Errors ───────────────────────────────────────────────────────────────
    error ContractPaused();
    error ContractNotPaused();
    error NotPauseAdmin();
    error NotPauseGuardian();
    error NotUnpauseSigner();
    error AlreadyApprovedUnpause();
    error TimeoutTooLong();
    error ZeroAddressNotAllowed();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier whenNotPaused() {
        if (paused()) revert ContractPaused();
        _;
    }

    modifier whenPaused() {
        if (!_paused) revert ContractNotPaused();
        _;
    }

    modifier onlyPauseAdmin() {
        if (msg.sender != pauseAdmin) revert NotPauseAdmin();
        _;
    }

    modifier onlyPauseGuardian() {
        if (msg.sender != pauseGuardian) revert NotPauseGuardian();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /// @param _admin Admin address that can manage guardians and signers
    /// @param _guardian Single guardian who can trigger emergency pause
    /// @param _unpauseSigners Addresses required for multi-sig unpause
    /// @param _threshold Number of signer approvals needed to unpause
    /// @param _timeout Auto-unpause timeout in seconds (max 72 hours)
    constructor(
        address _admin,
        address _guardian,
        address[] memory _unpauseSigners,
        uint256 _threshold,
        uint256 _timeout
    ) {
        if (_admin == address(0) || _guardian == address(0)) revert ZeroAddressNotAllowed();
        if (_timeout > MAX_PAUSE_TIMEOUT) revert TimeoutTooLong();

        pauseAdmin = _admin;
        pauseGuardian = _guardian;
        unpauseThreshold = _threshold;
        _unpauseTimeout = _timeout;

        for (uint256 i; i < _unpauseSigners.length; ) {
            unpauseSigners[_unpauseSigners[i]] = true;
            _signerList.push(_unpauseSigners[i]);
            unchecked { ++i; }
        }
    }

    // ── View ─────────────────────────────────────────────────────────────────

    /// @notice Returns true if paused AND the timeout hasn't expired.
    function paused() public view returns (bool) {
        if (!_paused) return false;
        if (_unpauseTimeout > 0 && block.timestamp >= _pausedAt + _unpauseTimeout) {
            return false;
        }
        return true;
    }

    function pausedAt() external view returns (uint256) {
        return _pausedAt;
    }

    function unpauseTimeout() external view returns (uint256) {
        return _unpauseTimeout;
    }

    function unpauseApprovalCount() external view returns (uint256) {
        return _unpauseApprovalCount;
    }

    // ── Emergency Pause (single guardian) ────────────────────────────────────

    /// @notice Guardian triggers emergency pause. Timelock governs unpause.
    function emergencyPause() external onlyPauseGuardian {
        _paused = true;
        _pausedAt = block.timestamp;
        _unpauseApprovalCount = 0;

        for (uint256 i; i < _signerList.length; ) {
            _hasApprovedUnpause[_signerList[i]] = false;
            unchecked { ++i; }
        }

        emit Paused(msg.sender, block.timestamp, _unpauseTimeout);
    }

    // ── Multi-sig Unpause ────────────────────────────────────────────────────

    /// @notice Signer approves unpause. When threshold is met, contract unpauses.
    function approveUnpause() external whenPaused {
        if (!unpauseSigners[msg.sender]) revert NotUnpauseSigner();
        if (_hasApprovedUnpause[msg.sender]) revert AlreadyApprovedUnpause();

        _hasApprovedUnpause[msg.sender] = true;
        unchecked { ++_unpauseApprovalCount; }

        emit UnpauseApproved(msg.sender, _unpauseApprovalCount, unpauseThreshold);

        if (_unpauseApprovalCount >= unpauseThreshold) {
            _paused = false;
            emit Unpaused(msg.sender, block.timestamp, "multi-sig");
        }
    }

    /// @notice Anyone can call this to finalize auto-unpause after timeout.
    function finalizeAutoUnpause() external {
        if (!_paused) revert ContractNotPaused();
        if (_unpauseTimeout == 0 || block.timestamp < _pausedAt + _unpauseTimeout) {
            revert ContractPaused();
        }
        _paused = false;
        emit Unpaused(msg.sender, block.timestamp, "timeout");
    }

    // ── Admin Configuration ──────────────────────────────────────────────────

    function setPauseGuardian(address newGuardian) external onlyPauseAdmin {
        if (newGuardian == address(0)) revert ZeroAddressNotAllowed();
        address old = pauseGuardian;
        pauseGuardian = newGuardian;
        emit PauseGuardianChanged(old, newGuardian);
    }

    function setUnpauseSigner(address signer, bool active) external onlyPauseAdmin {
        if (signer == address(0)) revert ZeroAddressNotAllowed();
        if (active && !unpauseSigners[signer]) {
            _signerList.push(signer);
        }
        unpauseSigners[signer] = active;
        emit UnpauseSignerUpdated(signer, active);
    }

    function setUnpauseTimeout(uint256 timeout) external onlyPauseAdmin {
        if (timeout > MAX_PAUSE_TIMEOUT) revert TimeoutTooLong();
        _unpauseTimeout = timeout;
    }
}
