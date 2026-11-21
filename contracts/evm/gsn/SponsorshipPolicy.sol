// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SponsorshipPolicy
/// @notice On-chain sponsorship budget management per merchant/app.
///         Merchants deposit ETH budgets; the relay server debits gas costs.
///         Enforces per-wallet rate limits and per-tx gas caps.
contract SponsorshipPolicy {
    // ── Storage ──────────────────────────────────────────────────────────────

    address public owner;
    address public relayServer; // Backend relay server address

    struct Budget {
        uint256 totalDeposited;  // Lifetime ETH deposited
        uint256 spent;           // ETH spent on sponsorship so far
        uint256 gasCapPerTx;     // Max gas units sponsorable per tx
        uint256 rateLimitPerDay; // Max sponsored txs per wallet per day
        bool    active;
    }

    struct WalletUsage {
        uint256 txCountToday;
        uint256 dayStart;  // timestamp of day window start
    }

    // merchantId (bytes32) → Budget
    mapping(bytes32 => Budget) public budgets;

    // merchantId → walletAddress → daily usage
    mapping(bytes32 => mapping(address => WalletUsage)) public walletUsage;

    // ── Events ───────────────────────────────────────────────────────────────

    event BudgetDeposited(bytes32 indexed merchantId, uint256 amount);
    event BudgetWithdrawn(bytes32 indexed merchantId, uint256 amount);
    event GasCostBilled(bytes32 indexed merchantId, address indexed wallet, uint256 gasCostWei);
    event BudgetExhausted(bytes32 indexed merchantId);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotRelayServer();
    error BudgetInactive();
    error BudgetExhaustedErr();
    error RateLimitExceeded();
    error GasCapExceeded(uint256 requested, uint256 cap);
    error InsufficientBudget(uint256 needed, uint256 available);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _relayServer) {
        owner = msg.sender;
        relayServer = _relayServer;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelay() {
        if (msg.sender != relayServer) revert NotRelayServer();
        _;
    }

    // ── Budget management ────────────────────────────────────────────────────

    function depositBudget(
        bytes32 merchantId,
        uint256 gasCapPerTx,
        uint256 rateLimitPerDay
    ) external payable {
        Budget storage b = budgets[merchantId];
        b.totalDeposited += msg.value;
        b.gasCapPerTx    = gasCapPerTx;
        b.rateLimitPerDay = rateLimitPerDay;
        b.active         = true;
        emit BudgetDeposited(merchantId, msg.value);
    }

    function withdrawBudget(bytes32 merchantId, uint256 amount) external onlyOwner {
        Budget storage b = budgets[merchantId];
        uint256 available = b.totalDeposited - b.spent;
        require(available >= amount, "Insufficient");
        b.totalDeposited -= amount;
        payable(owner).transfer(amount);
        emit BudgetWithdrawn(merchantId, amount);
    }

    // ── Sponsorship check & billing ──────────────────────────────────────────

    /// @notice Called by relay server to verify and bill a sponsorship.
    /// @param merchantId  Merchant identifier.
    /// @param wallet      User wallet being sponsored.
    /// @param gasUnits    Gas units used by the meta-tx.
    /// @param gasPrice    Effective gas price (wei).
    function billSponsorship(
        bytes32 merchantId,
        address wallet,
        uint256 gasUnits,
        uint256 gasPrice
    ) external onlyRelay {
        Budget storage b = budgets[merchantId];
        if (!b.active) revert BudgetInactive();

        // Gas cap check
        if (gasUnits > b.gasCapPerTx) revert GasCapExceeded(gasUnits, b.gasCapPerTx);

        // Rate limit check
        WalletUsage storage usage = walletUsage[merchantId][wallet];
        _refreshDayWindow(usage);
        if (usage.txCountToday >= b.rateLimitPerDay) revert RateLimitExceeded();

        uint256 cost = gasUnits * gasPrice;
        uint256 available = b.totalDeposited - b.spent;
        if (cost > available) {
            b.active = false;
            emit BudgetExhausted(merchantId);
            revert InsufficientBudget(cost, available);
        }

        b.spent += cost;
        usage.txCountToday++;

        emit GasCostBilled(merchantId, wallet, cost);
    }

    /// @notice Returns available balance for a merchant budget.
    function availableBalance(bytes32 merchantId) external view returns (uint256) {
        Budget storage b = budgets[merchantId];
        return b.totalDeposited - b.spent;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _refreshDayWindow(WalletUsage storage usage) internal {
        uint256 oneDayAgo = block.timestamp - 86_400;
        if (usage.dayStart < oneDayAgo) {
            usage.txCountToday = 0;
            usage.dayStart = block.timestamp;
        }
    }
}
