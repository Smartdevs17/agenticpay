// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GenericBridge
 * @notice Abstract base contract for cross-chain liquidity bridging
 * @dev Implementations must override _initiateBridge and _verifyBridgeCompletion
 */
abstract contract GenericBridge is ReentrancyGuard, Ownable {
    
    struct BridgeRequest {
        address sender;
        address recipient;
        uint256 amount;
        uint256 sourceChainId;
        uint256 targetChainId;
        bytes32 txHash;
        uint256 timestamp;
        bool completed;
    }
    
    mapping(bytes32 => BridgeRequest) public bridgeRequests;
    mapping(uint256 => bool) public supportedChains;
    
    uint256 public bridgeFeeBasisPoints = 10; // 0.1%
    uint256 public constant MAX_FEE_BASIS_POINTS = 100; // 1%
    
    event BridgeInitiated(
        bytes32 indexed requestId,
        address indexed sender,
        uint256 targetChainId,
        uint256 amount
    );
    
    event BridgeCompleted(
        bytes32 indexed requestId,
        address indexed recipient,
        uint256 amount
    );
    
    event BridgeFailed(
        bytes32 indexed requestId,
        string reason
    );
    
    modifier onlySupportedChain(uint256 chainId) {
        require(supportedChains[chainId], "Chain not supported");
        _;
    }
    
    function addSupportedChain(uint256 chainId) external onlyOwner {
        supportedChains[chainId] = true;
    }
    
    function removeSupportedChain(uint256 chainId) external onlyOwner {
        supportedChains[chainId] = false;
    }
    
    function setBridgeFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE_BASIS_POINTS, "Fee too high");
        bridgeFeeBasisPoints = newFee;
    }
    
    function calculateBridgeFee(uint256 amount) public view returns (uint256) {
        return (amount * bridgeFeeBasisPoints) / 10000;
    }
    
    function initiateBridge(
        address recipient,
        uint256 targetChainId,
        uint256 amount
    ) external payable nonReentrant onlySupportedChain(targetChainId) returns (bytes32) {
        require(amount > 0, "Amount must be greater than 0");
        require(recipient != address(0), "Invalid recipient");
        
        uint256 fee = calculateBridgeFee(amount);
        require(msg.value >= amount + fee, "Insufficient funds");
        
        bytes32 requestId = keccak256(abi.encodePacked(
            msg.sender,
            recipient,
            amount,
            block.chainid,
            targetChainId,
            block.timestamp,
            block.number
        ));
        
        bridgeRequests[requestId] = BridgeRequest({
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            sourceChainId: block.chainid,
            targetChainId: targetChainId,
            txHash: bytes32(0),
            timestamp: block.timestamp,
            completed: false
        });
        
        _initiateBridge(requestId, recipient, targetChainId, amount);
        
        emit BridgeInitiated(requestId, msg.sender, targetChainId, amount);
        
        // Refund excess
        if (msg.value > amount + fee) {
            payable(msg.sender).transfer(msg.value - amount - fee);
        }
        
        return requestId;
    }
    
    function completeBridge(bytes32 requestId, bytes32 targetTxHash) external onlyOwner {
        BridgeRequest storage request = bridgeRequests[requestId];
        require(request.sender != address(0), "Request not found");
        require(!request.completed, "Already completed");
        
        request.txHash = targetTxHash;
        request.completed = true;
        
        _verifyBridgeCompletion(requestId, targetTxHash);
        
        emit BridgeCompleted(requestId, request.recipient, request.amount);
    }
    
    function failBridge(bytes32 requestId, string calldata reason) external onlyOwner {
        BridgeRequest storage request = bridgeRequests[requestId];
        require(request.sender != address(0), "Request not found");
        require(!request.completed, "Already completed");
        
        // Refund sender
        payable(request.sender).transfer(request.amount + calculateBridgeFee(request.amount));
        
        emit BridgeFailed(requestId, reason);
    }
    
    // Internal functions to be implemented by specific bridge adapters
    function _initiateBridge(
        bytes32 requestId,
        address recipient,
        uint256 targetChainId,
        uint256 amount
    ) internal virtual;
    
    function _verifyBridgeCompletion(bytes32 requestId, bytes32 targetTxHash) internal virtual;
}