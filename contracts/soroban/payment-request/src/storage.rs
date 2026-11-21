use soroban_sdk::{symbol_short, Address, Env};
use crate::errors::RequestError;
use crate::types::PaymentRequest;

const BUMP_AMOUNT: u32 = 518_400;
const BUMP_THRESHOLD: u32 = 100_000;

pub fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&symbol_short!("init"))
}
pub fn mark_initialized(env: &Env) {
    env.storage().instance().set(&symbol_short!("init"), &true);
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&symbol_short!("admin"), admin);
}
pub fn get_admin(env: &Env) -> Result<Address, RequestError> {
    env.storage().instance()
        .get::<_, Address>(&symbol_short!("admin"))
        .ok_or(RequestError::NotInitialized)
}
pub fn require_admin(env: &Env) -> Result<(), RequestError> {
    let admin = get_admin(env)?;
    admin.require_auth();
    Ok(())
}

pub fn set_grace_period(env: &Env, secs: u64) {
    env.storage().instance().set(&symbol_short!("grace"), &secs);
}
pub fn get_grace_period(env: &Env) -> u64 {
    env.storage().instance()
        .get::<_, u64>(&symbol_short!("grace"))
        .unwrap_or(60)
}

pub fn get_next_id(env: &Env) -> u64 {
    env.storage().instance()
        .get::<_, u64>(&symbol_short!("next_id"))
        .unwrap_or(1)
}
pub fn inc_next_id(env: &Env) {
    let id = get_next_id(env);
    env.storage().instance().set(&symbol_short!("next_id"), &(id + 1));
}

/// Requests stored in persistent storage keyed by ID.
pub fn set_request(env: &Env, id: u64, req: &PaymentRequest) {
    env.storage().persistent().set(&id, req);
    env.storage().persistent().extend_ttl(&id, BUMP_THRESHOLD, BUMP_AMOUNT);
}
pub fn get_request(env: &Env, id: u64) -> Result<PaymentRequest, RequestError> {
    env.storage().persistent()
        .get::<u64, PaymentRequest>(&id)
        .ok_or(RequestError::NotFound)
}
