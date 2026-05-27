methods {
    function nonce() external returns(uint256) envfree;
    function execute((address,uint256,bytes)[]) external;
    function executeWithAuth((address,uint256,bytes)[],uint256,bytes) external;
}

rule direct_execute_requires_self_sender(env e, (address,uint256,bytes)[] calls)
    filtered { e.msg.sender != currentContract }
{
    execute@withrevert(e, calls);
    assert lastReverted, "direct 7702 execution must be called by the delegated account itself";
}

rule expired_authorization_reverts(env e, (address,uint256,bytes)[] calls, uint256 deadline, bytes signature)
    filtered { deadline != 0 && e.block.timestamp > deadline }
{
    executeWithAuth@withrevert(e, calls, deadline, signature);
    assert lastReverted, "expired relayer authorization must revert";
}

rule successful_authorized_execute_consumes_nonce(env e, (address,uint256,bytes)[] calls, uint256 deadline, bytes signature)
{
    uint256 beforeNonce = nonce();

    executeWithAuth@withrevert(e, calls, deadline, signature);

    if (!lastReverted) {
        assert nonce() == beforeNonce + 1,
            "successful authorized execution must consume exactly one nonce";
    }
}
