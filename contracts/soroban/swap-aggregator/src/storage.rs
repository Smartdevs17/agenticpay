use soroban_sdk::{Address, Env, String, Vec, symbol_short};
use crate::errors::AggregatorError;
use crate::types::DexEntry;

const ADMIN_KEY: &str = "admin";
const FEE_KEY: &str = "fee_bps";
const INIT_KEY: &str = "init";
const DEX_LIST_KEY: &str = "dex_list";

/// Ledger TTL bumps — keep instance storage alive for ~1 year on testnet.
const BUMP_AMOUNT: u32 = 518_400; // ~1 year in ledgers at 5 s/ledger
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

pub fn get_admin(env: &Env) -> Result<Address, AggregatorError> {
    env.storage()
        .instance()
        .get::<_, Address>(&symbol_short!("admin"))
        .ok_or(AggregatorError::NotInitialized)
}

pub fn require_admin(env: &Env) -> Result<(), AggregatorError> {
    let admin = get_admin(env)?;
    admin.require_auth();
    Ok(())
}

pub fn set_fee_bps(env: &Env, fee_bps: u32) {
    env.storage().instance().set(&symbol_short!("fee_bps"), &fee_bps);
}

pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&symbol_short!("fee_bps"))
        .unwrap_or(30) // default 0.3 %
}

pub fn add_dex(env: &Env, dex_id: String, dex_address: Address) {
    let mut list: Vec<DexEntry> = env
        .storage()
        .instance()
        .get::<_, Vec<DexEntry>>(&symbol_short!("dex_list"))
        .unwrap_or_else(|| Vec::new(env));

    // Replace if already present, otherwise append.
    let mut found = false;
    for i in 0..list.len() {
        let entry = list.get(i).unwrap();
        if entry.dex_id == dex_id {
            list.set(i, DexEntry { dex_id: dex_id.clone(), dex_address: dex_address.clone(), active: true });
            found = true;
            break;
        }
    }
    if !found {
        list.push_back(DexEntry { dex_id, dex_address, active: true });
    }
    env.storage().instance().set(&symbol_short!("dex_list"), &list);
}

pub fn remove_dex(env: &Env, dex_id: String) {
    let mut list: Vec<DexEntry> = env
        .storage()
        .instance()
        .get::<_, Vec<DexEntry>>(&symbol_short!("dex_list"))
        .unwrap_or_else(|| Vec::new(env));

    let mut new_list: Vec<DexEntry> = Vec::new(env);
    for i in 0..list.len() {
        let entry = list.get(i).unwrap();
        if entry.dex_id != dex_id {
            new_list.push_back(entry);
        }
    }
    env.storage().instance().set(&symbol_short!("dex_list"), &new_list);
}

pub fn get_dex_list(env: &Env) -> Vec<String> {
    let list: Vec<DexEntry> = env
        .storage()
        .instance()
        .get::<_, Vec<DexEntry>>(&symbol_short!("dex_list"))
        .unwrap_or_else(|| Vec::new(env));

    let mut ids: Vec<String> = Vec::new(env);
    for i in 0..list.len() {
        let entry = list.get(i).unwrap();
        if entry.active {
            ids.push_back(entry.dex_id);
        }
    }
    ids
}

pub fn get_dex_entries(env: &Env) -> Vec<DexEntry> {
    env.storage()
        .instance()
        .get::<_, Vec<DexEntry>>(&symbol_short!("dex_list"))
        .unwrap_or_else(|| Vec::new(env))
}
