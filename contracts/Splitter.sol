// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgenticPay Splitter
/// @notice Reference contract for split-payment distribution and platform fees.
contract Splitter {
    struct Recipient {
        address wallet;
        uint16 bps; // basis points (10000 = 100%)
        uint256 minThreshold;
        bool active;
    }

    address public owner;
    uint16 public platformFeeBps;
    Recipient[] public recipients;

    event RecipientConfigured(uint256 indexed index, address wallet, uint16 bps, uint256 minThreshold, bool active);
    event PlatformFeeUpdated(uint16 feeBps);
    event PaymentSplit(uint256 totalAmount, uint256 platformFee, uint256 distributedAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(uint16 initialPlatformFeeBps) {
        require(initialPlatformFeeBps <= 10000, "Invalid fee");
        owner = msg.sender;
        platformFeeBps = initialPlatformFeeBps;
    }

    function setPlatformFeeBps(uint16 feeBps) external onlyOwner {
        require(feeBps <= 10000, "Invalid fee");
        platformFeeBps = feeBps;
        emit PlatformFeeUpdated(feeBps);
    }

    function setRecipient(
        uint256 index,
        address wallet,
        uint16 bps,
        uint256 minThreshold,
        bool active
    ) external onlyOwner {
        require(wallet != address(0), "Invalid recipient");
        require(bps <= 10000, "Invalid bps");

        Recipient memory next = Recipient(wallet, bps, minThreshold, active);
        if (index < recipients.length) {
            recipients[index] = next;
        } else {
            require(index == recipients.length, "Invalid index");
            recipients.push(next);
        }

        emit RecipientConfigured(index, wallet, bps, minThreshold, active);
    }

    function recipientsCount() external view returns (uint256) {
        return recipients.length;
    }

    function splitPayment() external payable {
        require(msg.value > 0, "No payment");
        uint256 platformFee = (msg.value * platformFeeBps) / 10000;
        uint256 distributable = msg.value - platformFee;
        uint256 distributed;

        for (uint256 i = 0; i < recipients.length; i++) {
            Recipient memory recipient = recipients[i];
            if (!recipient.active || recipient.bps == 0) continue;

            uint256 amount = (distributable * recipient.bps) / 10000;
            if (amount < recipient.minThreshold) continue;
            distributed += amount;
            (bool ok, ) = recipient.wallet.call{value: amount}("");
            require(ok, "Transfer failed");
        }

        // Keep platform fee and undistributed dust in contract
        emit PaymentSplit(msg.value, platformFee, distributed);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid to");
        require(amount <= address(this).balance, "Insufficient balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Withdraw failed");
    }
}
