// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GasPriceOracle
/// @notice Dynamic fee calculation with ERC-20 to ETH conversion rate support.
///         Provides gas price quotes with TTL for meta-transaction relayers.
contract GasPriceOracle {
    // ── State ────────────────────────────────────────────────────────────────

    address public owner;
    uint256 public baseFeePremium;     // Additional premium on top of base fee (in wei)
    uint256 public priorityFee;        // Priority fee for faster inclusion (in wei)

    struct FeeQuote {
        uint256 baseFee;
        uint256 priorityFee;
        uint256 maxFeePerGas;
        uint256 tokenFee;        // Fee in ERC-20 tokens (if applicable)
        uint256 validUntil;      // Quote expiry timestamp
    }

    // Token address => price ratio (token per ETH, scaled by 1e18)
    mapping(address => uint256) public tokenPriceRatios;
    mapping(address => bool) public authorizedUpdaters;

    // ── Events ───────────────────────────────────────────────────────────────

    event PriceRatioUpdated(address indexed token, uint256 ratio);
    event BaseFeePremiumUpdated(uint256 oldPremium, uint256 newPremium);
    event PriorityFeeUpdated(uint256 oldFee, uint256 newFee);
    event UpdaterUpdated(address indexed updater, bool active);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();
    error InvalidRatio();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyUpdater() {
        if (!authorizedUpdaters[msg.sender] && msg.sender != owner) revert NotAuthorized();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(uint256 _baseFeePremium, uint256 _priorityFee) {
        owner = msg.sender;
        baseFeePremium = _baseFeePremium;
        priorityFee = _priorityFee;
    }

    // ── Fee Quote ────────────────────────────────────────────────────────────

    /// @notice Generate a fee quote valid for `ttlSeconds`.
    /// @param token Address of the ERC-20 token for fee payment (address(0) for ETH).
    /// @param ttlSeconds How long the quote is valid.
    /// @return quote The fee quote struct.
    function getQuote(address token, uint256 ttlSeconds) external view returns (FeeQuote memory quote) {
        uint256 baseFee = block.basefee;
        uint256 pFee = priorityFee;
        uint256 maxFee = baseFee + baseFeePremium + pFee;

        uint256 tokenFee = 0;
        if (token != address(0) && tokenPriceRatios[token] > 0) {
            // Convert ETH fee to token fee: tokenFee = maxFee * ratio / 1e18
            tokenFee = (maxFee * tokenPriceRatios[token]) / 1e18;
        }

        quote = FeeQuote({
            baseFee: baseFee,
            priorityFee: pFee,
            maxFeePerGas: maxFee,
            tokenFee: tokenFee,
            validUntil: block.timestamp + ttlSeconds
        });
    }

    /// @notice Estimate the total gas cost in ETH for a given gas limit.
    function estimateGasCost(uint256 gasLimit) external view returns (uint256 costWei) {
        return (block.basefee + baseFeePremium + priorityFee) * gasLimit;
    }

    /// @notice Estimate gas cost in ERC-20 tokens.
    function estimateGasCostInToken(uint256 gasLimit, address token) external view returns (uint256 costTokens) {
        uint256 costWei = (block.basefee + baseFeePremium + priorityFee) * gasLimit;
        if (tokenPriceRatios[token] > 0) {
            costTokens = (costWei * tokenPriceRatios[token]) / 1e18;
        }
    }

    // ── Price Feed Management ────────────────────────────────────────────────

    /// @notice Set the price ratio for a token.
    /// @param token ERC-20 token address.
    /// @param ratio Token units per 1 ETH (scaled by 1e18). E.g., 2000e18 means 1 ETH = 2000 tokens.
    function setPriceRatio(address token, uint256 ratio) external onlyUpdater {
        if (token == address(0)) revert ZeroAddress();
        if (ratio == 0) revert InvalidRatio();
        tokenPriceRatios[token] = ratio;
        emit PriceRatioUpdated(token, ratio);
    }

    /// @notice Batch update price ratios.
    function setPriceRatios(address[] calldata tokens, uint256[] calldata ratios) external onlyUpdater {
        uint256 len = tokens.length;
        require(len == ratios.length, "Length mismatch");
        for (uint256 i; i < len; ) {
            if (tokens[i] != address(0) && ratios[i] > 0) {
                tokenPriceRatios[tokens[i]] = ratios[i];
                emit PriceRatioUpdated(tokens[i], ratios[i]);
            }
            unchecked { ++i; }
        }
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setBaseFeePremium(uint256 newPremium) external onlyOwner {
        uint256 old = baseFeePremium;
        baseFeePremium = newPremium;
        emit BaseFeePremiumUpdated(old, newPremium);
    }

    function setPriorityFee(uint256 newFee) external onlyOwner {
        uint256 old = priorityFee;
        priorityFee = newFee;
        emit PriorityFeeUpdated(old, newFee);
    }

    function setUpdater(address updater, bool active) external onlyOwner {
        if (updater == address(0)) revert ZeroAddress();
        authorizedUpdaters[updater] = active;
        emit UpdaterUpdated(updater, active);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
