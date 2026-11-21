// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

error InvalidSignerSet();
error DuplicateSigner();
error InvalidThreshold();
error InvalidTimelock();
error NotSigner();
error AlreadyVoted();
error ProposalNotPending();
error ProposalNotApproved();
error TimelockNotElapsed();
error AlreadyExecuted();
error AlreadyCancelled();
error NotProposer();
error TransferFailed();
error EmergencyThresholdMet();
error ZeroAddress();

contract Treasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct TreasuryConfig {
        address[] signers;
        uint256 threshold;
        uint256 regularTimelock;
        uint256 highValueTimelock;
        uint256 highValueThreshold;
        uint256 emergencyCancelThreshold;
    }

    enum ProposalStatus { Pending, Approved, Executed, Rejected, Cancelled, Expired }

    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        address target;
        uint256 amount;
        address token;
        bytes data;
        ProposalStatus status;
        uint256 approvalCount;
        uint256 rejectionCount;
        uint256 createdAt;
        uint256 timelockDelay;
        uint256 executeAfter;
    }

    TreasuryConfig private _config;
    uint256 private _proposalCount;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) private _hasApproved;
    mapping(uint256 => mapping(address => bool)) private _hasRejected;

    event Proposed(uint256 indexed id, address indexed proposer, uint256 amount, uint256 executeAfter);
    event Approved(uint256 indexed id, address indexed signer, uint256 approvalCount);
    event Rejected(uint256 indexed id, address indexed signer);
    event Executed(uint256 indexed id, address indexed target);
    event Cancelled(uint256 indexed id, address indexed caller);
    event EmergencyCancelled(uint256 indexed id, address indexed signer, uint256 rejectionCount);
    event ConfigUpdated(address[] signers, uint256 threshold);

    constructor(
        address[] memory signers_,
        uint256 threshold_,
        uint256 regularTimelock_,
        uint256 highValueTimelock_,
        uint256 highValueThreshold_,
        uint256 emergencyCancelThreshold_
    ) {
        if (signers_.length == 0 || signers_.length > 20) revert InvalidSignerSet();
        if (threshold_ == 0 || threshold_ > signers_.length) revert InvalidThreshold();
        if (emergencyCancelThreshold_ < threshold_ || emergencyCancelThreshold_ > signers_.length) revert InvalidThreshold();
        if (regularTimelock_ < 60 || regularTimelock_ > 7 days) revert InvalidTimelock();
        if (highValueTimelock_ < 60 || highValueTimelock_ > 7 days) revert InvalidTimelock();
        if (highValueTimelock_ < regularTimelock_) revert InvalidTimelock();

        for (uint256 i = 0; i < signers_.length; i++) {
            for (uint256 j = i + 1; j < signers_.length; j++) {
                if (signers_[i] == signers_[j]) revert DuplicateSigner();
            }
            if (signers_[i] == address(0)) revert ZeroAddress();
        }

        _config = TreasuryConfig({
            signers: signers_,
            threshold: threshold_,
            regularTimelock: regularTimelock_,
            highValueTimelock: highValueTimelock_,
            highValueThreshold: highValueThreshold_,
            emergencyCancelThreshold: emergencyCancelThreshold_
        });
    }

    function getConfig() external view returns (TreasuryConfig memory) {
        return _config;
    }

    function _isSigner(address account) private view returns (bool) {
        for (uint256 i = 0; i < _config.signers.length; i++) {
            if (_config.signers[i] == account) return true;
        }
        return false;
    }

    function propose(
        string calldata description,
        address target,
        uint256 amount,
        address token,
        bytes calldata data
    ) external returns (uint256) {
        if (!_isSigner(msg.sender)) revert NotSigner();

        _proposalCount++;
        uint256 timelock = amount >= _config.highValueThreshold
            ? _config.highValueTimelock
            : _config.regularTimelock;
        uint256 executeAfter = block.timestamp + timelock;

        _proposals[_proposalCount] = Proposal({
            id: _proposalCount,
            proposer: msg.sender,
            description: description,
            target: target,
            amount: amount,
            token: token,
            data: data,
            status: ProposalStatus.Pending,
            approvalCount: 0,
            rejectionCount: 0,
            createdAt: block.timestamp,
            timelockDelay: timelock,
            executeAfter: executeAfter
        });

        emit Proposed(_proposalCount, msg.sender, amount, executeAfter);
        return _proposalCount;
    }

    function approve(uint256 proposalId) external {
        if (!_isSigner(msg.sender)) revert NotSigner();

        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotPending();
        if (p.status != ProposalStatus.Pending) revert ProposalNotPending();
        if (_hasApproved[proposalId][msg.sender] || _hasRejected[proposalId][msg.sender]) revert AlreadyVoted();

        _hasApproved[proposalId][msg.sender] = true;
        p.approvalCount++;

        if (p.approvalCount >= _config.threshold) {
            p.status = ProposalStatus.Approved;
        }

        emit Approved(proposalId, msg.sender, p.approvalCount);
    }

    function reject(uint256 proposalId) external {
        if (!_isSigner(msg.sender)) revert NotSigner();

        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotPending();
        if (p.status != ProposalStatus.Pending && p.status != ProposalStatus.Approved) revert ProposalNotPending();
        if (_hasApproved[proposalId][msg.sender] || _hasRejected[proposalId][msg.sender]) revert AlreadyVoted();

        _hasRejected[proposalId][msg.sender] = true;
        p.rejectionCount++;

        uint256 remainingSigners = _config.signers.length - p.rejectionCount;
        if (remainingSigners < _config.threshold) {
            p.status = ProposalStatus.Rejected;
        }

        emit Rejected(proposalId, msg.sender);
    }

    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotApproved();
        if (p.status != ProposalStatus.Approved) revert ProposalNotApproved();
        if (block.timestamp < p.executeAfter) revert TimelockNotElapsed();

        p.status = ProposalStatus.Executed;

        if (p.token == address(0)) {
            (bool success, ) = p.target.call{value: p.amount}(p.data);
            if (!success) revert TransferFailed();
        } else {
            IERC20(p.token).safeTransfer(p.target, p.amount);
        }

        emit Executed(proposalId, p.target);
    }

    function cancel(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotPending();
        if (p.status == ProposalStatus.Executed) revert AlreadyExecuted();
        if (p.status == ProposalStatus.Cancelled) revert AlreadyCancelled();

        if (msg.sender == p.proposer) {
            p.status = ProposalStatus.Cancelled;
        } else if (_isSigner(msg.sender) && p.status == ProposalStatus.Pending) {
            p.status = ProposalStatus.Cancelled;
        } else {
            revert NotProposer();
        }

        emit Cancelled(proposalId, msg.sender);
    }

    function emergencyCancel(uint256 proposalId) external {
        if (!_isSigner(msg.sender)) revert NotSigner();

        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotPending();
        if (p.status == ProposalStatus.Executed) revert AlreadyExecuted();

        if (_hasRejected[proposalId][msg.sender]) revert AlreadyVoted();
        _hasRejected[proposalId][msg.sender] = true;
        p.rejectionCount++;

        if (p.rejectionCount >= _config.emergencyCancelThreshold) {
            p.status = ProposalStatus.Cancelled;
        }

        emit EmergencyCancelled(proposalId, msg.sender, p.rejectionCount);
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function getProposalCount() external view returns (uint256) {
        return _proposalCount;
    }

    function hasApproved(uint256 proposalId, address signer) external view returns (bool) {
        return _hasApproved[proposalId][signer];
    }

    function hasRejected(uint256 proposalId, address signer) external view returns (bool) {
        return _hasRejected[proposalId][signer];
    }

    receive() external payable {}
}
