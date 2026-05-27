// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title SubscriptionManager
 * @dev Implements recurring payment logic with automation, dunning, pause/resume, and plan changes.
 */
contract SubscriptionManager is Ownable, ReentrancyGuard {
    enum SubscriptionStatus {
        None,
        Active,
        Paused,
        Cancelled,
        PastDue,
        Downgraded
    }

    struct Plan {
        address merchant;
        uint256 amount;
        uint256 interval; // seconds
        bool active;
        uint256 downgradePlanId;
        string metadata; // CID or JSON
    }

    struct Subscription {
        uint256 planId;
        uint256 lastPayment;
        uint256 nextPayment;
        uint8 retryCount;
        SubscriptionStatus status;
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
    event SubscriptionPaused(address indexed customer, uint256 indexed planId);
    event SubscriptionResumed(address indexed customer, uint256 indexed planId);
    event SubscriptionDowngraded(address indexed customer, uint256 indexed fromPlanId, uint256 indexed toPlanId);
    event DunningAttempt(address indexed customer, uint256 indexed planId, uint8 retryCount);

    constructor(address _paymentToken) {
        paymentToken = IERC20(_paymentToken);
    }

    function createPlan(uint256 _amount, uint256 _interval, string calldata _metadata) external {
        _createPlan(_amount, _interval, 0, _metadata);
    }

    function createPlanWithDowngrade(
        uint256 _amount,
        uint256 _interval,
        uint256 _downgradePlanId,
        string calldata _metadata
    ) external {
        if (_downgradePlanId != 0) {
            require(plans[_downgradePlanId].merchant == msg.sender, "Downgrade plan merchant mismatch");
            require(plans[_downgradePlanId].active, "Downgrade plan inactive");
        }
        _createPlan(_amount, _interval, _downgradePlanId, _metadata);
    }

    function _createPlan(
        uint256 _amount,
        uint256 _interval,
        uint256 _downgradePlanId,
        string calldata _metadata
    ) internal {
        require(_amount > 0, "Amount required");
        require(_interval >= 1 days, "Interval too short");
        planCount++;
        plans[planCount] = Plan(msg.sender, _amount, _interval, true, _downgradePlanId, _metadata);
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
        subscriptions[msg.sender][_planId] = Subscription(_planId, block.timestamp, nextPayment, 0, SubscriptionStatus.Active);
        
        emit Subscribed(msg.sender, _planId, nextPayment);
        emit PaymentExecuted(msg.sender, _planId, plan.amount);
    }

    function executePayment(address _customer, uint256 _planId) external nonReentrant {
        Subscription storage sub = subscriptions[_customer][_planId];
        Plan storage plan = plans[_planId];
        
        require(sub.status == SubscriptionStatus.Active, "Subscription inactive");
        require(block.timestamp >= sub.nextPayment, "Payment not due");
        require(plan.active, "Plan no longer active");

        sub.lastPayment = block.timestamp;
        sub.nextPayment = block.timestamp + plan.interval;
        sub.retryCount = 0;

        require(paymentToken.transferFrom(_customer, plan.merchant, plan.amount), "Recurring payment failed");
        
        emit PaymentExecuted(_customer, _planId, plan.amount);
    }

    function cancelSubscription(uint256 _planId) external {
        require(subscriptions[msg.sender][_planId].status == SubscriptionStatus.Active, "No active subscription");
        subscriptions[msg.sender][_planId].status = SubscriptionStatus.Cancelled;
        emit SubscriptionCancelled(msg.sender, _planId);
    }

    function pauseSubscription(uint256 _planId) external {
        Subscription storage sub = subscriptions[msg.sender][_planId];
        require(sub.status == SubscriptionStatus.Active, "No active subscription");
        sub.status = SubscriptionStatus.Paused;
        emit SubscriptionPaused(msg.sender, _planId);
    }

    function resumeSubscription(uint256 _planId) external {
        Subscription storage sub = subscriptions[msg.sender][_planId];
        require(sub.status == SubscriptionStatus.Paused, "Subscription not paused");
        sub.status = SubscriptionStatus.Active;
        sub.nextPayment = block.timestamp + plans[_planId].interval;
        emit SubscriptionResumed(msg.sender, _planId);
    }

    function recordDunningFailure(address _customer, uint256 _planId) external {
        Subscription storage sub = subscriptions[_customer][_planId];
        Plan storage plan = plans[_planId];
        require(plan.merchant == msg.sender, "Only merchant");
        require(sub.status == SubscriptionStatus.Active || sub.status == SubscriptionStatus.PastDue, "Not billable");

        sub.retryCount++;
        sub.status = SubscriptionStatus.PastDue;
        emit DunningAttempt(_customer, _planId, sub.retryCount);

        if (sub.retryCount >= 3) {
            if (plan.downgradePlanId != 0) {
                sub.planId = plan.downgradePlanId;
                sub.status = SubscriptionStatus.Downgraded;
                emit SubscriptionDowngraded(_customer, _planId, plan.downgradePlanId);
            } else {
                sub.status = SubscriptionStatus.Cancelled;
                emit SubscriptionCancelled(_customer, _planId);
            }
        }
    }
}
