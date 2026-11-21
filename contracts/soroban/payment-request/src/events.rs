use soroban_sdk::{symbol_short, Address, Env, String};

pub fn emit_created(
    env: &Env,
    id: u64,
    requester: &Address,
    payer: Option<&Address>,
    token: &Address,
    amount: i128,
    expires_at: u64,
    memo: &String,
) {
    env.events().publish(
        (symbol_short!("req_crtd"), requester.clone()),
        (id, payer.cloned(), token.clone(), amount, expires_at, memo.clone()),
    );
}

pub fn emit_paid(env: &Env, id: u64, requester: &Address, payer: &Address, amount: i128, paid_at: u64) {
    env.events().publish(
        (symbol_short!("req_paid"), requester.clone()),
        (id, payer.clone(), amount, paid_at),
    );
}

pub fn emit_expired(env: &Env, id: u64, requester: &Address, expired_at: u64) {
    env.events().publish(
        (symbol_short!("req_expd"), requester.clone()),
        (id, expired_at),
    );
}

pub fn emit_cancelled(env: &Env, id: u64, requester: &Address) {
    env.events().publish(
        (symbol_short!("req_cncl"), requester.clone()),
        (id,),
    );
}

pub fn emit_renewed(env: &Env, old_id: u64, new_id: u64, new_amount: i128, new_expires_at: u64) {
    env.events().publish(
        (symbol_short!("req_rnwd"),),
        (old_id, new_id, new_amount, new_expires_at),
    );
}
