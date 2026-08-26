#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

/// Vault lifecycle status.
#[contracttype]
#[derive(Clone)]
pub enum VaultStatus {
    Pending,
    Active,
    Disputed,
    Completed,
    Refunded,
}

/// Milestone completion status.
#[contracttype]
#[derive(Clone)]
pub enum MilestoneStatus {
    Pending,
    Approved,
    Released,
    Expired,
    Disputed,
}

/// Persistent storage keys for a vault.
#[contracttype]
pub enum VaultDataKey {
    VaultCount,
    Vault(u64),
    Milestone(u64, u32),
}

/// On-ledger vault record.
#[contracttype]
#[derive(Clone)]
pub struct Vault {
    pub depositor: Address,
    pub recipient: Address,
    pub total_amount: i128,
    pub released_amount: i128,
    pub status: VaultStatus,
    pub milestone_count: u32,
}

/// On-ledger milestone record.
#[contracttype]
#[derive(Clone)]
pub struct Milestone {
    pub name: String,
    pub amount_bps: u32,   // basis points of total_amount; sum across milestones = 10 000
    pub deadline: u64,     // Unix seconds; 0 = no deadline
    pub approver: Address,
    pub status: MilestoneStatus,
}

#[contract]
pub struct PaymentVaultContract;

#[contractimpl]
impl PaymentVaultContract {
    /// Deposit funds and create a vault with a milestone schedule.
    /// `milestone_bps` must sum to 10 000.
    pub fn create_vault(
        _env: Env,
        _depositor: Address,
        _recipient: Address,
        _amount: i128,
        _names: Vec<String>,
        _milestone_bps: Vec<u32>,
        _deadlines: Vec<u64>,
        _approvers: Vec<Address>,
    ) -> u64 {
        todo!("create_vault: deposit funds and register milestone schedule")
    }

    /// Approver (or depositor) marks a milestone as complete.
    pub fn approve_milestone(_env: Env, _vault_id: u64, _milestone_index: u32) {
        todo!("approve_milestone: verify caller is approver, release funds")
    }

    /// Auto-release a milestone whose deadline has passed.
    pub fn release_expired_milestone(_env: Env, _vault_id: u64, _milestone_index: u32) {
        todo!("release_expired_milestone: check deadline, transfer funds")
    }

    /// Refund all unreleased funds to the depositor.
    pub fn refund(_env: Env, _vault_id: u64) {
        todo!("refund: verify depositor, return remaining balance")
    }

    /// Raise a dispute to freeze milestone releases.
    pub fn raise_dispute(_env: Env, _vault_id: u64) {
        todo!("raise_dispute: set vault status to Disputed")
    }

    /// Resolve a dispute — release to recipient or refund to depositor.
    pub fn resolve_dispute(_env: Env, _vault_id: u64, _release_to_recipient: bool) {
        todo!("resolve_dispute: admin only, transfer remaining balance")
    }

    /// Read a vault record.
    pub fn get_vault(_env: Env, _vault_id: u64) -> Vault {
        todo!("get_vault: return Vault struct from storage")
    }

    /// Read a specific milestone.
    pub fn get_milestone(_env: Env, _vault_id: u64, _milestone_index: u32) -> Milestone {
        todo!("get_milestone: return Milestone struct from storage")
    }
}
