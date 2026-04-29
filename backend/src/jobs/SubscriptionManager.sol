// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title SubscriptionManager
 * @dev Implements recurring payment logic with automation support.
 */
contract SubscriptionManager is Ownable, ReentrancyGuard {
    struct Plan {
        address merchant;
        uint256 amount;
        uint256 interval; // seconds
        bool active;
        string metadata; // CID or JSON
    }

    struct Subscription {
        uint256 planId;
        uint256 lastPayment;
        uint256 nextPayment;
        bool active;
    }

    IERC20 public paymentToken;
    uint256 public planCount;

    mapping(uint256 => Plan) public plans;
    // customer => planId => Subscription
    mapping(address => mapping(uint256 => Subscription)) public subscriptions;

    event PlanCreated(uint256 indexed planId, address indexed merchant, uint256 amount, uint256 interval);
    event PlanUpdated(uint256 indexed planId, bool active);
    event Subscribed(address indexed customer, uint256 indexed planId, uint256 nextPayment);
    event PaymentExecuted(address indexed customer, uint256 indexed planId, uint256 amount);
    event SubscriptionCancelled(address indexed customer, uint256 indexed planId);

    constructor(address _paymentToken) {
        paymentToken = IERC20(_paymentToken);
    }

    function createPlan(uint256 _amount, uint256 _interval, string calldata _metadata) external {
        planCount++;
        plans[planCount] = Plan(msg.sender, _amount, _interval, true, _metadata);
        emit PlanCreated(planCount, msg.sender, _amount, _interval);
    }

    function updatePlan(uint256 _planId, bool _active) external {
        require(plans[_planId].merchant == msg.sender, "Only merchant");
        plans[_planId].active = _active;
        emit PlanUpdated(_planId, _active);
    }

    function subscribe(uint256 _planId) external nonReentrant {
        Plan storage plan = plans[_planId];
        require(plan.active, "Plan is not active");
        
        // Execute first payment immediately
        require(paymentToken.transferFrom(msg.sender, plan.merchant, plan.amount), "Initial payment failed");

        uint256 nextPayment = block.timestamp + plan.interval;
        subscriptions[msg.sender][_planId] = Subscription(_planId, block.timestamp, nextPayment, true);
        
        emit Subscribed(msg.sender, _planId, nextPayment);
        emit PaymentExecuted(msg.sender, _planId, plan.amount);
    }

    function executePayment(address _customer, uint256 _planId) external nonReentrant {
        Subscription storage sub = subscriptions[_customer][_planId];
        Plan storage plan = plans[_planId];
        
        require(sub.active, "Subscription inactive");
        require(block.timestamp >= sub.nextPayment, "Payment not due");
        require(plan.active, "Plan no longer active");

        sub.lastPayment = block.timestamp;
        sub.nextPayment = block.timestamp + plan.interval;

        require(paymentToken.transferFrom(_customer, plan.merchant, plan.amount), "Recurring payment failed");
        
        emit PaymentExecuted(_customer, _planId, plan.amount);
    }

    function cancelSubscription(uint256 _planId) external {
        require(subscriptions[msg.sender][_planId].active, "No active subscription");
        subscriptions[msg.sender][_planId].active = false;
        emit SubscriptionCancelled(msg.sender, _planId);
    }
}