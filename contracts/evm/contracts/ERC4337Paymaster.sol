// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IEntryPoint, UserOperation, IPaymaster, IStakeManager } from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/// @title ERC4337Paymaster
/// @notice ERC-4337 compatible paymaster that sponsors gas for UserOperations.
///         Supports two modes:
///         1. Verification paymaster (pre-signed sponsorship)
///         2. Deposit paymaster (pre-funded balance)
/// @dev Implements IPaymaster interface for EntryPoint v0.7 compatibility.
contract ERC4337Paymaster is IPaymaster {
    enum PaymasterMode {
        NONE,
        VERIFYING,
        DEPOSIT
    }

    // ── State ────────────────────────────────────────────────────────────────

    address public owner;
    IEntryPoint public immutable entryPoint;
    address public oracle;

    // Paymaster deposit balance in EntryPoint (for deposit mode)
    // For verifying mode, no deposit needed — sponsorship is pre-signed

    uint256 public totalSponsored;
    uint256 public totalFeesCollected;

    // Per-user budgets for deposit mode
    struct Budget {
        uint256 balance;
        uint256 maxGasPerTx;
    }

    mapping(address => Budget) public budgets;
    mapping(address => uint256) public tokenPriceRatios;
    mapping(address => bool) public acceptedTokens;
    mapping(address => bool) public relayers;

    // For verifying mode: signer that authorizes operations
    address public verifyingSigner;

    // ── Events ───────────────────────────────────────────────────────────────

    event UserOperationSponsored(
        address indexed sender,
        uint256 indexed nonce,
        bytes32 indexed userOpHash,
        uint256 actualGasCost
    );
    event BudgetDeposited(address indexed user, address indexed token, uint256 amount);
    event BudgetWithdrawn(address indexed user, address indexed token, uint256 amount);
    event TokenAccepted(address indexed token, bool accepted);
    event TokenRatioUpdated(address indexed token, uint256 ratio);
    event VerifyingSignerUpdated(address indexed signer);
    event RelayerUpdated(address indexed relayer, bool active);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotRelayer();
    error ZeroAddress();
    error InsufficientBudget();
    error TokenNotAccepted();
    error InvalidUserOperation();
    error SignatureExpired();
    error InvalidSignature();
    error BudgetExceeded();

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

    constructor(IEntryPoint _entryPoint, address _oracle, address _verifyingSigner) {
        owner = msg.sender;
        entryPoint = _entryPoint;
        oracle = _oracle;
        verifyingSigner = _verifyingSigner;
        _entryPoint.depositTo{ value: msg.value }(address(this));
    }

    // ── IPaymaster: validatePaymasterUserOp ─────────────────────────────────

    /// @notice Validates and pays for a UserOperation.
    /// @dev Called by EntryPoint during account abstraction flow.
    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        if (msg.sender != address(entryPoint)) revert InvalidUserOperation();

        (PaymasterMode mode, bytes memory signature) = abi.decode(userOp.paymasterAndData[20:], (PaymasterMode, bytes));

        if (mode == PaymasterMode.VERIFYING) {
            return _validateVerifying(userOpHash, signature, maxCost);
        } else if (mode == PaymasterMode.DEPOSIT) {
            return _validateDeposit(userOp.sender, maxCost);
        }

        revert InvalidUserOperation();
    }

    /// @notice Post-operation hook called by EntryPoint after UserOperation execution.
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external override {
        if (msg.sender != address(entryPoint)) revert InvalidUserOperation();

        (address sender, PaymasterMode postMode) = abi.decode(context, (address, PaymasterMode));

        if (postMode == PaymasterMode.DEPOSIT) {
            Budget storage budget = budgets[sender];
            if (budget.balance < actualGasCost) revert InsufficientBudget();
            unchecked {
                budget.balance -= actualGasCost;
                totalSponsored += actualGasCost;
            }
        }

        totalSponsored += actualGasCost;
        emit UserOperationSponsored(sender, 0, bytes32(0), actualGasCost);
    }

    // ── Internal Validation ─────────────────────────────────────────────────

    function _validateVerifying(
        bytes32 userOpHash,
        bytes memory signature,
        uint256 maxCost
    ) private view returns (bytes memory context, uint256 validationData) {
        bytes32 hash = _getHash(userOpHash);
        address signer = _recoverSigner(hash, signature);
        if (signer != verifyingSigner) revert InvalidSignature();

        context = abi.encode(address(0), PaymasterMode.VERIFYING);
        return (context, 0);
    }

    function _validateDeposit(
        address sender,
        uint256 maxCost
    ) private view returns (bytes memory context, uint256 validationData) {
        Budget storage budget = budgets[sender];
        if (budget.balance < maxCost) revert InsufficientBudget();
        if (budget.maxGasPerTx > 0 && maxCost > budget.maxGasPerTx) revert BudgetExceeded();

        context = abi.encode(sender, PaymasterMode.DEPOSIT);
        return (context, 0);
    }

    // ── Signature Helpers ────────────────────────────────────────────────────

    function _getHash(bytes32 userOpHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
    }

    function _recoverSigner(bytes32 hash, bytes memory signature) private pure returns (address) {
        (uint8 v, bytes32 r, bytes32 s) = _splitSignature(signature);
        return ecrecover(hash, v, r, s);
    }

    function _splitSignature(bytes memory sig) private pure returns (uint8 v, bytes32 r, bytes32 s) {
        if (sig.length != 65) revert InvalidSignature();
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }

    // ── Deposit Mode: Budget Management ──────────────────────────────────────

    function depositBudget(address token, uint256 amount) external {
        if (!acceptedTokens[token]) revert TokenNotAccepted();
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert("TokenTransferFailed");
        unchecked { budgets[msg.sender].balance += amount; }
        emit BudgetDeposited(msg.sender, token, amount);
    }

    function withdrawBudget(address token, uint256 amount) external {
        Budget storage budget = budgets[msg.sender];
        if (budget.balance < amount) revert InsufficientBudget();
        unchecked { budget.balance -= amount; }
        (bool ok, ) = token.call(abi.encodeWithSelector(0xa9059cbb, msg.sender, amount));
        if (!ok) revert("TokenTransferFailed");
        emit BudgetWithdrawn(msg.sender, token, amount);
    }

    function setMaxGasPerTx(address user, uint256 maxGas) external onlyOwner {
        budgets[user].maxGasPerTx = maxGas;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        acceptedTokens[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    function setTokenRatio(address token, uint256 ratio) external onlyOwner {
        tokenPriceRatios[token] = ratio;
        emit TokenRatioUpdated(token, ratio);
    }

    function setVerifyingSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        verifyingSigner = signer;
        emit VerifyingSignerUpdated(signer);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
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

    function addDeposit() external payable {
        entryPoint.depositTo{ value: msg.value }(address(this));
    }

    function withdrawFromEntryPoint(address payable withdrawAddress, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }

    receive() external payable {}
}
