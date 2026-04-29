// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./GenericBridge.sol";

/**
 * @title LayerZeroBridge
 * @notice LayerZero-specific bridge implementation
 */
contract LayerZeroBridge is GenericBridge {
    
    address public lzEndpoint;
    mapping(uint256 => uint16) public chainIdToLzId;
    
    event LzMessageSent(uint16 dstChainId, bytes payload);
    
    constructor(address _lzEndpoint) {
        lzEndpoint = _lzEndpoint;
        
        // LayerZero chain IDs
        chainIdToLzId[1] = 101; // Ethereum
        chainIdToLzId[137] = 109; // Polygon
        chainIdToLzId[42161] = 110; // Arbitrum
        chainIdToLzId[10] = 111; // Optimism
        chainIdToLzId[43114] = 106; // Avalanche
        chainIdToLzId[56] = 102; // BNB
    }
    
    function _initiateBridge(
        bytes32 requestId,
        address recipient,
        uint256 targetChainId,
        uint256 amount
    ) internal override {
        uint16 lzChainId = chainIdToLzId[targetChainId];
        require(lzChainId != 0, "Unsupported LZ chain");
        
        bytes memory payload = abi.encode(requestId, recipient, amount);
        
        // In production: call LayerZero endpoint with proper adapter params
        // ILayerZeroEndpoint(lzEndpoint).send{value: msg.value}(
        //     lzChainId,
        //     abi.encodePacked(address(this)),
        //     payload,
        //     payable(msg.sender),
        //     address(0x0),
        //     bytes("")
        // );
        
        emit LzMessageSent(lzChainId, payload);
    }
    
    function _verifyBridgeCompletion(bytes32 requestId, bytes32 targetTxHash) internal override {
        // Verification logic handled by LayerZero messaging layer
        // This would be called by the LZ receive function on the target chain
    }
    
    function lzReceive(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external {
        require(msg.sender == lzEndpoint, "Only LZ endpoint");
        
        (bytes32 requestId, address recipient, uint256 amount) = abi.decode(
            _payload,
            (bytes32, address, uint256)
        );
        
        // Complete the bridge on this chain
        bridgeRequests[requestId].completed = true;
        
        // Transfer funds to recipient
        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit BridgeCompleted(requestId, recipient, amount);
    }
    
    receive() external payable {}
}