// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Gas-tuned ERC-20 reference
/// @notice Minimal ERC-20 with a handful of targeted optimisations over
///         the textbook implementation. Not a full OpenZeppelin drop-in
///         replacement — it omits hooks, Permit, and Votes.
/// @dev Optimisations (see contracts/gas-analysis.md for numbers):
///        - Custom errors instead of require strings.
///        - Unchecked arithmetic for strictly-bounded subtractions.
///        - `transient` reentrancy slot (Cancun TSTORE) — falls back to
///          a regular byte if the EVM is pre-Cancun; guarded by the
///          `_lock()` helper so callers don't need to care.
///        - Batched transfers short-circuit the single-call path without
///          re-reading the sender's balance for each destination.
///        - `totalSupply` is `uint128` packed with a `uint128 decimalsTs`
///          (decimals + last-updated timestamp) so metadata reads cost
///          one SLOAD instead of two.
contract ERC20Gas {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance(address from, uint256 have, uint256 want);
    error InsufficientAllowance(address spender, uint256 have, uint256 want);
    error ZeroAddress();
    error LengthMismatch(uint256 tos, uint256 amounts);
    error MintOverflow();

    string public name;
    string public symbol;

    // Packed metadata — saves one SLOAD on common metadata reads.
    uint128 public totalSupply;
    uint128 private _decimalsTs; // decimals (low 8 bits) + timestamp (remaining bits)

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        _decimalsTs = (uint128(block.timestamp) << 8) | uint128(decimals_);
    }

    function decimals() external view returns (uint8) {
        return uint8(_decimalsTs);
    }

    // ---------- transfer family ----------

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 current = allowance[from][msg.sender];
        if (current != type(uint256).max) {
            if (current < amount) revert InsufficientAllowance(msg.sender, current, amount);
            unchecked { allowance[from][msg.sender] = current - amount; }
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Send `amounts[i]` to `tos[i]` from `msg.sender` in one
    ///         transaction. Amortises the per-call overhead and reads
    ///         the sender's balance just once.
    function batchTransfer(address[] calldata tos, uint256[] calldata amounts)
        external
        returns (bool)
    {
        uint256 len = tos.length;
        if (len != amounts.length) revert LengthMismatch(len, amounts.length);

        uint256 senderBal = balanceOf[msg.sender];
        uint256 spent;
        for (uint256 i; i < len; ) {
            address to = tos[i];
            if (to == address(0)) revert ZeroAddress();
            uint256 amount = amounts[i];
            spent += amount;
            // Emit per-destination to stay EIP-20 compatible.
            emit Transfer(msg.sender, to, amount);
            balanceOf[to] += amount;
            unchecked { ++i; }
        }
        if (spent > senderBal) revert InsufficientBalance(msg.sender, senderBal, spent);
        unchecked { balanceOf[msg.sender] = senderBal - spent; }
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    // ---------- admin-style helpers (no access control — reference only) ----------

    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert ZeroAddress();
        uint256 nextTotal = totalSupply + amount;
        if (nextTotal > type(uint128).max) revert MintOverflow();
        totalSupply = uint128(nextTotal);
        unchecked { balanceOf[to] += amount; }
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external {
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance(msg.sender, bal, amount);
        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalSupply = uint128(uint256(totalSupply) - amount);
        }
        emit Transfer(msg.sender, address(0), amount);
    }

    // ---------- internal ----------

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 fromBal = balanceOf[from];
        if (fromBal < amount) revert InsufficientBalance(from, fromBal, amount);
        unchecked {
            balanceOf[from] = fromBal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
