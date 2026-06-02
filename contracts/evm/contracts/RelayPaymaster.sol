// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RelayPaymaster
/// @notice GSN-compatible paymaster that sponsors gas for meta-transactions,
///         accepting ERC-20 fee payment from the user. The user pre-approves
///         token spending, and the paymaster deducts the gas fee in tokens
///         after relaying the transaction.
contract RelayPaymaster {
    // ── State ────────────────────────────────────────────────────────────────

    address public owner;
    address public forwarder;  // Trusted MetaTxForwarder address
    address public oracle;     // GasPriceOracle for fee conversion

    uint256 public totalSponsored;    // Total ETH spent on gas sponsorship
    uint256 public totalFeesCollected; // Total token fees collected

    struct UserDeposit {
        uint256 balance;       // Pre-deposited token balance for gas
        uint256 maxGasPerTx;   // Per-tx gas cap for this user
    }

    mapping(address => UserDeposit) public deposits;
    mapping(address => bool) public acceptedTokens;
    mapping(address => uint256) public tokenPriceRatios; // token => ratio (token per ETH, 1e18 scale)
    mapping(address => bool) public relayers;

    // ── Events ───────────────────────────────────────────────────────────────

    event GasSponsored(address indexed user, address indexed relayer, uint256 gasCostWei);
    event FeeCollected(address indexed user, address indexed token, uint256 tokenAmount);
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event TokenAccepted(address indexed token, bool accepted);
    event RelayerUpdated(address indexed relayer, bool active);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotRelayer();
    error ZeroAddress();
    error InsufficientDeposit();
    error TokenNotAccepted();
    error InvalidForwarder();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _forwarder, address _oracle) {
        owner = msg.sender;
        forwarder = _forwarder;
        oracle = _oracle;
    }

    // ── User Deposits ────────────────────────────────────────────────────────

    /// @notice Deposit ERC-20 tokens for gas payment.
    function deposit(address token, uint256 amount) external {
        if (!acceptedTokens[token]) revert TokenNotAccepted();

        // Pull tokens from user
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TransferFrom failed");

        deposits[msg.sender].balance += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraw unused deposit.
    function withdraw(address token, uint256 amount) external {
        UserDeposit storage dep = deposits[msg.sender];
        if (dep.balance < amount) revert InsufficientDeposit();

        dep.balance -= amount;
        (bool ok, ) = token.call(
            abi.encodeWithSelector(0xa9059cbb, msg.sender, amount)
        );
        require(ok, "Transfer failed");

        emit Withdrawn(msg.sender, token, amount);
    }

    // ── Gas Sponsorship ──────────────────────────────────────────────────────

    /// @notice Check if a user has sufficient deposit for estimated gas.
    function canSponsor(address user, uint256 estimatedGasWei) external view returns (bool) {
        UserDeposit storage dep = deposits[user];
        if (dep.balance == 0) return false;
        // This is a simplified check; real implementation would use oracle price
        return dep.balance >= estimatedGasWei; // rough approximation
    }

    /// @notice Called by relayer after successful meta-tx to collect fee in tokens.
    /// @param user The user whose deposit to charge.
    /// @param token The ERC-20 token for fee payment.
    /// @param gasCostWei The actual gas cost in ETH.
    function collectFee(address user, address token, uint256 gasCostWei) external onlyRelayer {
        if (!acceptedTokens[token]) revert TokenNotAccepted();

        uint256 ratio = tokenPriceRatios[token];
        if (ratio == 0) ratio = 1e18; // default 1:1 if no ratio set

        uint256 tokenFee = (gasCostWei * ratio) / 1e18;
        UserDeposit storage dep = deposits[user];
        if (dep.balance < tokenFee) revert InsufficientDeposit();

        dep.balance -= tokenFee;
        totalSponsored += gasCostWei;
        totalFeesCollected += tokenFee;

        emit GasSponsored(user, msg.sender, gasCostWei);
        emit FeeCollected(user, token, tokenFee);
    }

    /// @notice Sponsor gas directly from ETH balance (paymaster pays).
    receive() external payable {}

    // ── Admin ────────────────────────────────────────────────────────────────

    function setForwarder(address _forwarder) external onlyOwner {
        if (_forwarder == address(0)) revert ZeroAddress();
        forwarder = _forwarder;
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        acceptedTokens[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    function setTokenRatio(address token, uint256 ratio) external onlyOwner {
        tokenPriceRatios[token] = ratio;
    }

    function setRelayer(address relayer, bool active) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        relayers[relayer] = active;
        emit RelayerUpdated(relayer, active);
    }

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
