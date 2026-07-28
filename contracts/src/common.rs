use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env, String, Vec};

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

pub fn _acquire_lock(env: &Env) {
    let locked: bool = env
        .storage()
        .instance()
        .get(&DataKey::ReentrancyLock)
        .unwrap_or(false);
    assert!(!locked, "reentrant call");
    env.storage()
        .instance()
        .set(&DataKey::ReentrancyLock, &true);
}

pub fn _release_lock(env: &Env) {
    env.storage()
        .instance()
        .set(&DataKey::ReentrancyLock, &false);
}

pub fn _require_not_paused(env: &Env) {
    let paused: bool = env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false);
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
    env.storage().instance().set(&DataKey::ReentrancyLock, &false);
    env.storage().instance().set(&DataKey::Paused, &false);
}

pub fn pause(env: &Env, admin: Address) {
    admin.require_auth();
    let stored_admin = get_admin(env);
    assert!(admin == stored_admin, "Only admin can pause");
    _acquire_lock(env);
    env.storage().instance().set(&DataKey::Paused, &true);
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
    _acquire_lock(env);
    env.storage().instance().set(&DataKey::Paused, &false);
    env.events().publish(
        (symbol_short!("circuit"), symbol_short!("paused")),
        false,
    );
    _release_lock(env);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
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
