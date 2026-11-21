// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockReceiver {
    event Paid(address indexed originalSender, uint256 amount, bytes note);

    uint256 public totalPaid;
    address public lastSender;

    function pay(bytes calldata note) external payable {
        address originalSender = _msgSender2771();
        totalPaid += msg.value;
        lastSender = originalSender;
        emit Paid(originalSender, msg.value, note);
    }

    function _msgSender2771() internal view returns (address sender) {
        if (msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
}
