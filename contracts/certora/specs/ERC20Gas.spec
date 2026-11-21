methods {
    function totalSupply() external returns(uint128) envfree;
    function balanceOf(address) external returns(uint256) envfree;
    function allowance(address,address) external returns(uint256) envfree;
    function transfer(address,uint256) external returns(bool);
    function transferFrom(address,address,uint256) external returns(bool);
    function approve(address,uint256) external returns(bool);
    function mint(address,uint256) external;
    function burn(uint256) external;
}

rule transfer_preserves_sender_recipient_sum(env e, address to, uint256 amount)
    filtered { e.msg.sender != to && to != 0 }
{
    uint256 senderBefore = balanceOf(e.msg.sender);
    uint256 recipientBefore = balanceOf(to);

    transfer(e, to, amount);

    assert balanceOf(e.msg.sender) + balanceOf(to) == senderBefore + recipientBefore,
        "transfer must preserve sender + recipient balances";
}

rule transfer_requires_sufficient_balance(env e, address to, uint256 amount)
    filtered { to != 0 && balanceOf(e.msg.sender) < amount }
{
    transfer@withrevert(e, to, amount);
    assert lastReverted, "transfer must revert when balance is insufficient";
}

rule transfer_from_spends_allowance(env e, address from, address to, uint256 amount)
    filtered {
        to != 0 &&
        e.msg.sender != from &&
        allowance(from, e.msg.sender) != max_uint256 &&
        allowance(from, e.msg.sender) >= amount &&
        balanceOf(from) >= amount
    }
{
    uint256 allowanceBefore = allowance(from, e.msg.sender);

    transferFrom(e, from, to, amount);

    assert allowance(from, e.msg.sender) == allowanceBefore - amount,
        "finite allowance must decrease by the transferred amount";
}

rule mint_increases_supply_by_amount(env e, address to, uint256 amount)
    filtered { to != 0 && totalSupply() + amount <= max_uint128 }
{
    uint128 supplyBefore = totalSupply();

    mint(e, to, amount);

    assert totalSupply() == supplyBefore + amount,
        "mint must increase total supply by amount";
}

rule burn_decreases_supply_by_amount(env e, uint256 amount)
    filtered { balanceOf(e.msg.sender) >= amount }
{
    uint128 supplyBefore = totalSupply();

    burn(e, amount);

    assert totalSupply() == supplyBefore - amount,
        "burn must decrease total supply by amount";
}
