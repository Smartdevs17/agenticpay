use soroban_sdk::{Address, BytesN, Env};
use crate::common::{self, *};

pub fn create_lock(
    env: &Env,
    sender: Address,
    input: HtlcLockInput,
) -> u64 {
    common::_require_not_paused(env);
    sender.require_auth();
    common::_acquire_lock(env);

    let config: BridgeConfigData = env
        .storage()
        .instance()
        .get(&DataKey::BridgeConfig)
        .expect("Bridge config not initialized");
    assert!(!config.paused, "Bridge is paused");
    assert!(input.amount > 0, "Amount must be positive");
    assert!(input.timelock > env.ledger().timestamp(), "Timelock must be in the future");

    let mut count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::HtlcCount)
        .unwrap_or(0);
    count += 1;

    let lock = HtlcLock {
        id: count,
        sender: sender.clone(),
        recipient: input.recipient.clone(),
        amount: input.amount,
        hashlock: input.hashlock,
        timelock: input.timelock,
        dispute_window: input.dispute_window,
        status: HtlcStatus::Pending,
        target_chain: input.target_chain.clone(),
        target_lock_id: input.target_lock_id.clone(),
        created_at: env.ledger().timestamp(),
        claimed_at: 0,
        refunded_at: 0,
    };

    env.storage()
        .persistent()
        .set(&DataKey::HtlcLock(count), &lock);
    env.storage().instance().set(&DataKey::HtlcCount, &count);

    env.events().publish(
        (symbol_short!("htlc"), symbol_short!("locked")),
        (count, sender, input.recipient, input.amount, input.target_chain),
    );

    common::_release_lock(env);
    count
}

pub fn claim_lock(env: &Env, lock_id: u64, secret: BytesN<32>) {
    common::_require_not_paused(env);
    common::_acquire_lock(env);

    let mut lock: HtlcLock = env
        .storage()
        .persistent()
        .get(&DataKey::HtlcLock(lock_id))
        .expect("HTLC lock not found");

    assert!(lock.status == HtlcStatus::Pending, "Lock is not pending");
    assert!(
        env.ledger().timestamp() < lock.timelock,
        "Timelock has expired"
    );

    let computed_hash: BytesN<32> = env.crypto().sha256(&secret.clone().into()).into();
    assert!(computed_hash == lock.hashlock, "Invalid secret");

    lock.status = HtlcStatus::Claimed;
    lock.claimed_at = env.ledger().timestamp();

    env.storage()
        .persistent()
        .set(&DataKey::HtlcLock(lock_id), &lock);

    env.events().publish(
        (symbol_short!("htlc"), symbol_short!("claimed")),
        (lock_id, lock.sender, lock.recipient, lock.amount),
    );

    common::_release_lock(env);
}

pub fn refund_lock(env: &Env, lock_id: u64) {
    common::_require_not_paused(env);
    common::_acquire_lock(env);

    let mut lock: HtlcLock = env
        .storage()
        .persistent()
        .get(&DataKey::HtlcLock(lock_id))
        .expect("HTLC lock not found");

    assert!(lock.status == HtlcStatus::Pending, "Lock is not pending");
    let now = env.ledger().timestamp();
    assert!(now >= lock.timelock, "Timelock has not expired yet");

    lock.status = HtlcStatus::Refunded;
    lock.refunded_at = now;

    env.storage()
        .persistent()
        .set(&DataKey::HtlcLock(lock_id), &lock);

    env.events().publish(
        (symbol_short!("htlc"), symbol_short!("refunded")),
        (lock_id, lock.sender, lock.amount),
    );

    common::_release_lock(env);
}

pub fn get_lock(env: &Env, lock_id: u64) -> HtlcLock {
    env.storage()
        .persistent()
        .get(&DataKey::HtlcLock(lock_id))
        .expect("HTLC lock not found")
}
