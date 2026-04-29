// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BridgeHTLC
/// @notice Minimal HTLC + optimistic dispute bridge primitive for cross-chain transfers.
contract BridgeHTLC is Ownable, Pausable, ReentrancyGuard {
    struct Lock {
        address sender;
        address recipient;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool claimed;
        bool refunded;
        uint256 disputeDeadline;
    }

    mapping(bytes32 => Lock) public locks;
    uint16 public feeBps = 30;
    address public feeCollector;

    event Locked(bytes32 indexed lockId, address indexed sender, address indexed recipient, uint256 amount);
    event Claimed(bytes32 indexed lockId, bytes32 secretHash);
    event Refunded(bytes32 indexed lockId);
    event FeeConfigUpdated(uint16 feeBps, address feeCollector);
    event Disputed(bytes32 indexed lockId, address indexed disputer);

    error InvalidFee();
    error InvalidLock();
    error AlreadySettled();
    error InvalidSecret();
    error TimelockNotExpired();
    error DisputeWindowOpen();

    constructor(address owner_, address feeCollector_) Ownable(owner_) {
        feeCollector = feeCollector_;
    }

    function setFeeConfig(uint16 nextFeeBps, address nextCollector) external onlyOwner {
        if (nextFeeBps > 1000) revert InvalidFee();
        feeBps = nextFeeBps;
        feeCollector = nextCollector;
        emit FeeConfigUpdated(nextFeeBps, nextCollector);
    }

    function lock(
        bytes32 lockId,
        address recipient,
        bytes32 hashlock,
        uint256 timelock,
        uint256 disputeWindowSeconds
    ) external payable whenNotPaused nonReentrant {
        if (msg.value == 0 || recipient == address(0) || hashlock == bytes32(0) || timelock <= block.timestamp) {
            revert InvalidLock();
        }
        if (locks[lockId].sender != address(0)) revert InvalidLock();

        locks[lockId] = Lock({
            sender: msg.sender,
            recipient: recipient,
            amount: msg.value,
            hashlock: hashlock,
            timelock: timelock,
            claimed: false,
            refunded: false,
            disputeDeadline: block.timestamp + disputeWindowSeconds
        });

        emit Locked(lockId, msg.sender, recipient, msg.value);
    }

    function claim(bytes32 lockId, bytes32 secret) external whenNotPaused nonReentrant {
        Lock storage userLock = locks[lockId];
        if (userLock.sender == address(0)) revert InvalidLock();
        if (userLock.claimed || userLock.refunded) revert AlreadySettled();
        if (keccak256(abi.encodePacked(secret)) != userLock.hashlock) revert InvalidSecret();

        userLock.claimed = true;
        uint256 fee = (userLock.amount * feeBps) / 10_000;
        uint256 payout = userLock.amount - fee;

        (bool okRecipient, ) = userLock.recipient.call{value: payout}("");
        require(okRecipient, "recipient transfer failed");
        if (fee > 0 && feeCollector != address(0)) {
            (bool okFee, ) = feeCollector.call{value: fee}("");
            require(okFee, "fee transfer failed");
        }

        emit Claimed(lockId, keccak256(abi.encodePacked(secret)));
    }

    function refund(bytes32 lockId) external whenNotPaused nonReentrant {
        Lock storage userLock = locks[lockId];
        if (userLock.sender == address(0)) revert InvalidLock();
        if (userLock.claimed || userLock.refunded) revert AlreadySettled();
        if (block.timestamp < userLock.timelock) revert TimelockNotExpired();
        if (block.timestamp < userLock.disputeDeadline) revert DisputeWindowOpen();

        userLock.refunded = true;
        (bool ok, ) = userLock.sender.call{value: userLock.amount}("");
        require(ok, "refund transfer failed");
        emit Refunded(lockId);
    }

    function dispute(bytes32 lockId) external whenNotPaused {
        Lock storage userLock = locks[lockId];
        if (userLock.sender == address(0)) revert InvalidLock();
        if (userLock.claimed || userLock.refunded) revert AlreadySettled();
        userLock.disputeDeadline = block.timestamp + 1 days;
        emit Disputed(lockId, msg.sender);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
