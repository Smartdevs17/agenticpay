methods {
    function owner() external returns(address) envfree;
    function platformFeeBps() external returns(uint16) envfree;
    function setPlatformFeeBps(uint16) external;
    function setRecipient(uint256,address,uint16,uint256,bool) external;
    function withdraw(address,uint256) external;
}

rule only_owner_can_update_fee(env e, uint16 feeBps)
    filtered { e.msg.sender != owner() && feeBps <= 10000 }
{
    setPlatformFeeBps@withrevert(e, feeBps);
    assert lastReverted, "non-owner must not update platform fee";
}

rule platform_fee_bound(env e, uint16 feeBps)
    filtered { e.msg.sender == owner() }
{
    setPlatformFeeBps@withrevert(e, feeBps);

    if (feeBps > 10000) {
        assert lastReverted, "fees above 10000 bps must revert";
    } else {
        assert platformFeeBps() <= 10000, "stored platform fee must remain bounded";
    }
}

rule only_owner_can_withdraw(env e, address to, uint256 amount)
    filtered { e.msg.sender != owner() && to != 0 }
{
    withdraw@withrevert(e, to, amount);
    assert lastReverted, "non-owner withdraw must revert";
}

rule only_owner_can_configure_recipients(env e, uint256 index, address wallet, uint16 bps, uint256 threshold, bool active)
    filtered { e.msg.sender != owner() && wallet != 0 && bps <= 10000 }
{
    setRecipient@withrevert(e, index, wallet, bps, threshold, active);
    assert lastReverted, "non-owner recipient configuration must revert";
}
