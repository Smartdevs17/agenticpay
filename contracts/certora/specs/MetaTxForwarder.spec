methods {
    function nonces(address) external returns(uint256) envfree;
    function verify((address,address,uint256,uint256,uint256,uint48,bytes),bytes) external returns(bool) envfree;
    function execute((address,address,uint256,uint256,uint256,uint48,bytes),bytes) external returns(bool,bytes);
}

rule expired_request_is_not_verifiable(env e, address from, address to, uint256 value, uint256 gasLimit, uint256 nonce, uint48 deadline, bytes data, bytes signature)
    filtered { deadline != 0 && e.block.timestamp > deadline }
{
    bool ok = verify(e, (from, to, value, gasLimit, nonce, deadline, data), signature);
    assert !ok, "expired requests must not verify";
}

rule execute_rejects_replayed_nonce(env e, address from, address to, uint256 value, uint256 gasLimit, uint256 nonce, uint48 deadline, bytes data, bytes signature)
    filtered { nonces(from) != nonce }
{
    execute@withrevert(e, (from, to, value, gasLimit, nonce, deadline, data), signature);
    assert lastReverted, "execute must reject stale or future nonce";
}

rule successful_execute_increments_nonce(env e, address from, address to, uint256 value, uint256 gasLimit, uint48 deadline, bytes data, bytes signature)
    filtered { nonces(from) < max_uint256 && to != 0 }
{
    uint256 beforeNonce = nonces(from);

    execute@withrevert(e, (from, to, value, gasLimit, beforeNonce, deadline, data), signature);

    if (!lastReverted) {
        assert nonces(from) == beforeNonce + 1,
            "successful execution must consume exactly one nonce";
    }
}
