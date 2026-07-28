#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Transfer {
    pub to: Address,
    pub amount: i128,
    pub memo: String,
}

#[contracttype]
#[derive(Clone)]
pub struct BatchResult {
    pub success_count: u32,
    pub failure_count: u32,
    pub failed_indices: Vec<u32>,
}

#[contracttype]
#[derive(Clone)]
pub struct BatchRecord {
    pub id: u64,
    pub initiator: Address,
    pub total_transfers: u32,
    pub success_count: u32,
    pub failure_count: u32,
    pub executed: bool,
    pub rolled_back: bool,
    pub created_at: u64,
}

#[contracttype]
pub enum DataKey {
    BatchCount,
    Batch(u64),
    Initialized,
    Admin,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BatchError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    EmptyBatch = 4,
    InvalidAmount = 5,
    TransferFailed = 6,
    BatchAlreadyExecuted = 7,
    BatchNotFound = 8,
    RollbackFailed = 9,
    BatchLimitExceeded = 10,
}

const MAX_BATCH_SIZE: u32 = 100;
const BUMP_AMOUNT: u32 = 518_400;
const BUMP_THRESHOLD: u32 = 100_000;

#[contract]
pub struct BatchTransferContract;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

#[contractimpl]
impl BatchTransferContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::BatchCount, &0u64);
        bump_instance(&env);
    }

    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn execute_batch(
        env: Env,
        initiator: Address,
        transfers: Vec<Transfer>,
    ) -> BatchResult {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic!("not initialized");
        }
        initiator.require_auth();

        let count = transfers.len();
        if count == 0 {
            panic!("empty batch");
        }
        if count > MAX_BATCH_SIZE {
            panic!("batch limit exceeded");
        }

        let mut success_count: u32 = 0;
        let mut failed_indices: Vec<u32> = Vec::new(&env);

        for (i, transfer) in transfers.iter().enumerate() {
            let idx = i as u32;
            if transfer.amount <= 0 {
                failed_indices.push_back(idx);
                continue;
            }
            let result = env.balance().try_transfer(
                &initiator,
                &transfer.to,
                &transfer.amount,
            );
            match result {
                Ok(_) => {
                    success_count += 1;
                }
                Err(_) => {
                    failed_indices.push_back(idx);
                }
            }
        }

        let failure_count = count - success_count;
        let batch_id: u64 = {
            let mut count: u64 = env
                .storage()
                .instance()
                .get(&DataKey::BatchCount)
                .expect("not initialized");
            count += 1;
            env.storage().instance().set(&DataKey::BatchCount, &count);
            count
        };

        let record = BatchRecord {
            id: batch_id,
            initiator: initiator.clone(),
            total_transfers: count,
            success_count,
            failure_count,
            executed: true,
            rolled_back: false,
            created_at: env.ledger().timestamp(),
        };
        env.storage().instance().set(&DataKey::Batch(batch_id), &record);
        bump_instance(&env);

        BatchResult {
            success_count,
            failure_count,
            failed_indices,
        }
    }

    pub fn rollback_batch(
        env: Env,
        admin: Address,
        batch_id: u64,
        original_initiator: Address,
        failed_indices: Vec<u32>,
        transfers: Vec<Transfer>,
    ) -> BatchResult {
        admin.require_auth();

        let record: BatchRecord = env
            .storage()
            .instance()
            .get(&DataKey::Batch(batch_id))
            .expect("batch not found");

        if !record.executed || record.rolled_back {
            panic!("batch cannot be rolled back");
        }

        let mut rollback_success: u32 = 0;
        let mut rollback_failed: Vec<u32> = Vec::new(&env);

        for idx in failed_indices.iter() {
            let transfer = transfers.get(idx).expect("invalid index");
            let result = env.balance().try_transfer(
                &transfer.to,
                &original_initiator,
                &transfer.amount,
            );
            match result {
                Ok(_) => {
                    rollback_success += 1;
                }
                Err(_) => {
                    rollback_failed.push_back(idx);
                }
            }
        }

        let mut updated = record;
        updated.rolled_back = true;
        env.storage()
            .instance()
            .set(&DataKey::Batch(batch_id), &updated);
        bump_instance(&env);

        BatchResult {
            success_count: rollback_success,
            failure_count: rollback_failed.len(),
            failed_indices: rollback_failed,
        }
    }

    pub fn get_batch(env: Env, batch_id: u64) -> BatchRecord {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Batch(batch_id))
            .expect("batch not found")
    }

    pub fn get_batch_count(env: Env) -> u64 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::BatchCount)
            .unwrap_or(0)
    }
}
