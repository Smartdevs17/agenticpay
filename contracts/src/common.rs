pub use soroban_sdk::{contracttype, symbol_short, Address, Bytes, BytesN, Env, String, Vec};

use crate::storage::{LazyKey, LazyValue};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProjectStatus {
    Created,
    Funded,
    InProgress,
    WorkSubmitted,
    Verified,
    Completed,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Project {
    pub id: u64,
    pub client: Address,
    pub freelancer: Address,
    pub amount: i128,
    pub deposited: i128,
    pub status: ProjectStatus,
    pub github_repo: String,
    pub description: String,
    pub created_at: u64,
    pub deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Receipt {
    pub id: u64,
    pub project_id: u64,
    pub amount: i128,
    pub currency: String,
    pub sender: Address,
    pub recipient: Address,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Project(u64),
    ProjectCount,
    Receipt(u64),
    ReceiptCount,
    Admin,
    Metadata(String),
    ReentrancyLock,
    Paused,
    MultisigWalletCount,
    MultisigWallet(u64),
    MultisigProposalCount,
    MultisigProposal(u64),
    HtlcCount,
    HtlcLock(u64),
    BridgeConfig,
    V2(crate::storage::StorageKey),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MultisigProposalStatus {
    Pending,
    Executed,
    Rejected,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigWallet {
    pub id: u64,
    pub signers: Vec<Address>,
    pub threshold: u32,
    pub timeout_ledgers: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigProposal {
    pub id: u64,
    pub wallet_id: u64,
    pub amount: i128,
    pub recipient: Address,
    pub description: String,
    pub status: MultisigProposalStatus,
    pub approvals: Vec<Address>,
    pub rejections: Vec<Address>,
    pub created_at: u64,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum HtlcStatus {
    Pending,
    Claimed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct HtlcLock {
    pub id: u64,
    pub sender: Address,
    pub recipient: Address,
    pub amount: i128,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub dispute_window: u64,
    pub status: HtlcStatus,
    pub target_chain: String,
    pub target_lock_id: String,
    pub created_at: u64,
    pub claimed_at: u64,
    pub refunded_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BridgeConfigData {
    pub fee_bps: u32,
    pub fee_collector: Address,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct HtlcLockInput {
    pub recipient: Address,
    pub amount: i128,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub dispute_window: u64,
    pub target_chain: String,
    pub target_lock_id: String,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProjectInput {
    pub freelancer: Address,
    pub amount: i128,
    pub description: String,
    pub github_repo: String,
}

// ReentrancyLock and Paused are read on every mutative call but written
// only during initialise / pause / unpause. `LazyValue` avoids paying the
// initialise SSTORE cost for paths that never toggle the circuit breaker
// or trigger reentrancy — the first read returns the default without a
// storage write. This is the single canonical lock/pause implementation;
// every module (`escrow`, `dispute`, `multisig`, `htlc`) and the contract's
// own admin entry points share it so a reentrancy guard or pause acquired
// in one module is visible to all the others.
fn _lock() -> LazyValue<bool> {
    LazyValue::new(LazyKey::ReentrancyLock, false)
}

fn _pause_flag() -> LazyValue<bool> {
    LazyValue::new(LazyKey::Paused, false)
}

pub fn _acquire_lock(env: &Env) {
    let locked = _lock().get(env);
    assert!(!locked, "reentrant call");
    _lock().set(env, &true);
}

pub fn _release_lock(env: &Env) {
    _lock().set(env, &false);
}

pub fn _require_not_paused(env: &Env) {
    let paused = _pause_flag().get(env);
    assert!(!paused, "contract paused");
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized")
}

pub fn initialize(env: &Env, admin: Address) {
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().instance().set(&DataKey::ProjectCount, &0u64);
    env.storage().instance().set(&DataKey::ReceiptCount, &0u64);
    // ReentrancyLock and Paused are lazily initialised via LazyValue — the
    // first read returns `false` without a storage write.
}

pub fn pause(env: &Env, admin: Address) {
    admin.require_auth();
    let stored_admin = get_admin(env);
    assert!(admin == stored_admin, "Only admin can pause");
    // Acquire lock so pause cannot be called re-entrantly.
    _acquire_lock(env);
    _pause_flag().set(env, &true);
    env.events().publish(
        (symbol_short!("circuit"), symbol_short!("paused")),
        true,
    );
    _release_lock(env);
}

pub fn unpause(env: &Env, admin: Address) {
    admin.require_auth();
    let stored_admin = get_admin(env);
    assert!(admin == stored_admin, "Only admin can unpause");
    // Acquire lock so unpause cannot be called re-entrantly.
    _acquire_lock(env);
    _pause_flag().set(env, &false);
    env.events().publish(
        (symbol_short!("circuit"), symbol_short!("paused")),
        false,
    );
    _release_lock(env);
}

pub fn is_paused(env: &Env) -> bool {
    _pause_flag().get(env)
}

pub fn set_metadata(env: &Env, admin: Address, key: String, value: String) {
    _require_not_paused(env);
    admin.require_auth();
    _acquire_lock(env);
    let stored_admin = get_admin(env);
    assert!(admin == stored_admin, "Only admin can set metadata");

    env.storage()
        .persistent()
        .set(&DataKey::Metadata(key.clone()), &value);

    env.events().publish(
        (symbol_short!("meta"), symbol_short!("set")),
        (key, value),
    );

    _release_lock(env);
}

pub fn get_metadata(env: &Env, key: String) -> Option<String> {
    env.storage().persistent().get(&DataKey::Metadata(key))
}

pub fn remove_metadata(env: &Env, admin: Address, key: String) {
    _require_not_paused(env);
    admin.require_auth();
    _acquire_lock(env);
    let stored_admin = get_admin(env);
    assert!(admin == stored_admin, "Only admin can remove metadata");

    env.storage().persistent().remove(&DataKey::Metadata(key.clone()));

    env.events().publish(
        (symbol_short!("meta"), symbol_short!("del")),
        key,
    );

    _release_lock(env);
}

pub fn upgrade(env: &Env, admin: Address, new_wasm_hash: BytesN<32>) {
    admin.require_auth();

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    assert!(admin == stored_admin, "Only admin can upgrade");

    env.deployer().update_current_contract_wasm(new_wasm_hash);
}

pub fn version(_env: &Env) -> u32 {
    1
}

pub fn init_bridge_config(env: &Env, admin: Address, fee_bps: u32, fee_collector: Address) {
    admin.require_auth();
    let stored_admin = get_admin(env);
    assert!(admin == stored_admin, "Only admin can init bridge config");
    assert!(fee_bps <= 1000, "Fee bps cannot exceed 1000 (10%)");

    let config = BridgeConfigData {
        fee_bps,
        fee_collector,
        paused: false,
    };
    env.storage()
        .instance()
        .set(&DataKey::BridgeConfig, &config);

    env.events().publish(
        (symbol_short!("bridge"), symbol_short!("config")),
        (fee_bps,),
    );
}

pub fn update_bridge_config(
    env: &Env,
    admin: Address,
    fee_bps: Option<u32>,
    fee_collector: Option<Address>,
    paused: Option<bool>,
) {
    admin.require_auth();
    let stored_admin = get_admin(env);
    assert!(admin == stored_admin, "Only admin can update bridge config");

    let mut config: BridgeConfigData = env
        .storage()
        .instance()
        .get(&DataKey::BridgeConfig)
        .expect("Bridge config not initialized");

    if let Some(fee) = fee_bps {
        assert!(fee <= 1000, "Fee bps cannot exceed 1000 (10%)");
        config.fee_bps = fee;
    }
    if let Some(collector) = fee_collector {
        config.fee_collector = collector;
    }
    if let Some(p) = paused {
        config.paused = p;
    }

    env.storage()
        .instance()
        .set(&DataKey::BridgeConfig, &config);
}

pub fn get_bridge_config(env: &Env) -> BridgeConfigData {
    env.storage()
        .instance()
        .get(&DataKey::BridgeConfig)
        .expect("Bridge config not initialized")
}
