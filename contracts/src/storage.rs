use soroban_sdk::{contracttype, Address, Env, String};

// ---------------------------------------------------------------------------
// Gas-optimized storage utilities for AgenticPay contracts.
//
// # Storage slot packing
// Soroban persistent storage uses XDR-serialized key-value pairs. Each
// `Env::storage().persistent().set()` / `.instance().set()` call costs a
// write. To minimise gas we:
//
//   1. Pack multiple small fields into a single struct per logical entity.
//   2. Use `LazyValue<T>` to defer writes for optional/rarely-accessed data.
//   3. Avoid `Vec` in storage keys — use fixed-size key schemes instead.
//   4. Batch counter updates with a single write after all items are written.
//
// # Lazy initialisation
// Flags like `ReentrancyLock` and `Paused` are read on every mutative call
// but only written during initialise / pause / unpause. Using `LazyValue`
// avoids paying the initialise SSTORE cost for rarely-used paths.
// ---------------------------------------------------------------------------

// ── Lazy storage value ───────────────────────────────────────────────────────
// Wraps an optional value. The first `get_or_init` call writes the default
// to persistent/instance storage; subsequent reads bypass the init closure.

#[contracttype]
pub enum LazyKey {
    ReentrancyLock,
    Paused,
}

pub struct LazyValue<
    T: soroban_sdk::IntoVal<Env, soroban_sdk::Val> + soroban_sdk::TryFromVal<Env, soroban_sdk::Val>,
> {
    key: LazyKey,
    default: T,
}

impl<
        T: soroban_sdk::IntoVal<Env, soroban_sdk::Val>
            + soroban_sdk::TryFromVal<Env, soroban_sdk::Val>
            + Clone,
    > LazyValue<T>
{
    pub fn new(key: LazyKey, default: T) -> Self {
        LazyValue { key, default }
    }

    /// Read from instance storage, falling back to the default without writing.
    pub fn get(&self, env: &Env) -> T {
        env.storage()
            .instance()
            .get(&self.key)
            .unwrap_or(self.default.clone())
    }

    /// Read and initialise if absent (writes default to storage on first call).
    /// Use this for hot-read values that should have a storage entry after init.
    pub fn get_or_init(&self, env: &Env) -> T {
        if let Some(val) = env.storage().instance().get(&self.key) {
            val
        } else {
            env.storage().instance().set(&self.key, &self.default);
            self.default.clone()
        }
    }

    pub fn set(&self, env: &Env, value: &T) {
        env.storage().instance().set(&self.key, value);
    }
}

// ── Approval bitmap (gas-optimised replacement for Vec<Address>) ────────────
// Stores up to 128 approvals / rejections in a single u128 bitmask instead
// of a Vec of Addresses. Reduces storage writes from N×32 bytes to 16 bytes.

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ApprovalBitmap {
    /// Bitmask: bit i = 1 means signer at index i has approved.
    pub approvals: u128,
    /// Bitmask: bit i = 1 means signer at index i has rejected.
    pub rejections: u128,
}

impl ApprovalBitmap {
    pub fn new() -> Self {
        ApprovalBitmap {
            approvals: 0,
            rejections: 0,
        }
    }

    pub fn has_approved(&self, signer_index: u32) -> bool {
        if signer_index >= 128 {
            return false;
        }
        (self.approvals >> signer_index) & 1 == 1
    }

    pub fn has_rejected(&self, signer_index: u32) -> bool {
        if signer_index >= 128 {
            return false;
        }
        (self.rejections >> signer_index) & 1 == 1
    }

    pub fn approve(&mut self, signer_index: u32) {
        if signer_index < 128 {
            self.approvals |= 1u128 << signer_index;
        }
    }

    pub fn reject(&mut self, signer_index: u32) {
        if signer_index < 128 {
            self.rejections |= 1u128 << signer_index;
        }
    }

    pub fn approval_count(&self) -> u32 {
        self.approvals.count_ones()
    }

    pub fn rejection_count(&self) -> u32 {
        self.rejections.count_ones()
    }
}

// ── Packed project storage (v2) ─────────────────────────────────────────────
// Optimised field order minimises XDR encoding size. Fields that are rarely
// read together are grouped into separate keys (lazy loading).

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProjectStatusV2 {
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
pub struct ProjectV2 {
    pub id: u64,
    pub client: Address,
    pub freelancer: Address,
    pub amount: i128,
    pub deposited: i128,
    pub header: PackedProjectHeader,
    pub github_repo: String,
    pub description: String,
}

const PROJECT_FLAG_HAS_DEADLINE: u32 = 1;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PackedProjectHeader {
    pub status: u32,
    pub flags: u32,
    pub created_at: u64,
    pub deadline: u64,
}

impl PackedProjectHeader {
    pub fn new(status: ProjectStatusV2, created_at: u64, deadline: u64) -> Self {
        let flags = if deadline > 0 {
            PROJECT_FLAG_HAS_DEADLINE
        } else {
            0
        };
        Self {
            status: status.to_u32(),
            flags,
            created_at,
            deadline,
        }
    }

    pub fn status(&self) -> ProjectStatusV2 {
        ProjectStatusV2::from_u32(self.status)
    }

    pub fn set_status(&mut self, status: ProjectStatusV2) {
        self.status = status.to_u32();
    }

    pub fn has_deadline(&self) -> bool {
        self.flags & PROJECT_FLAG_HAS_DEADLINE != 0
    }
}

impl ProjectStatusV2 {
    pub fn to_u32(&self) -> u32 {
        match self {
            ProjectStatusV2::Created => 0,
            ProjectStatusV2::Funded => 1,
            ProjectStatusV2::InProgress => 2,
            ProjectStatusV2::WorkSubmitted => 3,
            ProjectStatusV2::Verified => 4,
            ProjectStatusV2::Completed => 5,
            ProjectStatusV2::Disputed => 6,
            ProjectStatusV2::Cancelled => 7,
        }
    }

    pub fn from_u32(value: u32) -> Self {
        match value {
            0 => ProjectStatusV2::Created,
            1 => ProjectStatusV2::Funded,
            2 => ProjectStatusV2::InProgress,
            3 => ProjectStatusV2::WorkSubmitted,
            4 => ProjectStatusV2::Verified,
            5 => ProjectStatusV2::Completed,
            6 => ProjectStatusV2::Disputed,
            7 => ProjectStatusV2::Cancelled,
            _ => panic!("Invalid project status"),
        }
    }
}

// ── Gas-optimised storage key layout ────────────────────────────────────────
// Uses a flat enum to minimise XDR key size. Counter keys share a single
// storage slot with their entity keys to reduce the total number of
// DataKey variants the contract must decode.

#[contracttype]
pub enum StorageKey {
    // ---- Instance storage ----
    Admin,
    BridgeConfig,
    // Lazy flags are stored under these keys but only written on first use.
    ReentrancyLock,
    Paused,
    // ---- Counters ----
    ProjectCounter,
    ReceiptCounter,
    WalletCounter,
    ProposalCounter,
    HtlcCounter,
    // ---- Persistent entity storage ----
    Project(u64),
    Receipt(u64),
    Wallet(u64),
    Proposal(u64),
    ApprovalBitmap(u64), // proposal_id → bitmap (instead of Vec in Proposal)
    HtlcLock(u64),
    Signer(u64, u32), // (wallet_id, index) → Address
    Metadata(String),
}

// ── Storage migration ───────────────────────────────────────────────────────
// Reads old-format data and re-writes it in the new packed layout.

#[cfg(test)]
pub mod migration {
    use super::*;
    use crate::{DataKey, Project};

    pub fn migrate_project_v1_to_v2(env: &Env, project_id: u64) {
        let old: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("Project not found");

        let new = ProjectV2 {
            id: old.id,
            client: old.client,
            freelancer: old.freelancer,
            amount: old.amount,
            deposited: old.deposited,
            header: PackedProjectHeader::new(
                match old.status {
                    crate::ProjectStatus::Created => ProjectStatusV2::Created,
                    crate::ProjectStatus::Funded => ProjectStatusV2::Funded,
                    crate::ProjectStatus::InProgress => ProjectStatusV2::InProgress,
                    crate::ProjectStatus::WorkSubmitted => ProjectStatusV2::WorkSubmitted,
                    crate::ProjectStatus::Verified => ProjectStatusV2::Verified,
                    crate::ProjectStatus::Completed => ProjectStatusV2::Completed,
                    crate::ProjectStatus::Disputed => ProjectStatusV2::Disputed,
                    crate::ProjectStatus::Cancelled => ProjectStatusV2::Cancelled,
                },
                old.created_at,
                old.deadline,
            ),
            github_repo: old.github_repo,
            description: old.description,
        };

        env.storage()
            .persistent()
            .set(&StorageKey::Project(project_id), &new);
        env.storage()
            .persistent()
            .remove(&DataKey::Project(project_id));
    }

    pub fn migrate_all(env: &Env, count: u64) {
        for id in 1..=count {
            migrate_project_v1_to_v2(env, id);
        }
    }

    #[test]
    fn test_lazy_value_operations() {
        let env = Env::default();
        let contract_id = env.register_contract(None, crate::AgenticPayContract);

        env.as_contract(&contract_id, || {
            let lazy_lock = LazyValue::new(LazyKey::ReentrancyLock, false);

            // Before init, get returns default false without writing
            assert_eq!(lazy_lock.get(&env), false);

            // get_or_init returns default and initializes
            assert_eq!(lazy_lock.get_or_init(&env), false);

            // Set to true
            lazy_lock.set(&env, &true);
            assert_eq!(lazy_lock.get(&env), true);
        });
    }

    #[test]
    fn test_approval_bitmap_operations() {
        let mut bitmap = ApprovalBitmap::new();
        assert_eq!(bitmap.has_approved(0), false);
        assert_eq!(bitmap.has_rejected(0), false);

        bitmap.approve(0);
        bitmap.approve(5);
        bitmap.reject(2);

        assert_eq!(bitmap.has_approved(0), true);
        assert_eq!(bitmap.has_approved(5), true);
        assert_eq!(bitmap.has_approved(1), false);
        assert_eq!(bitmap.has_rejected(2), true);
        assert_eq!(bitmap.has_rejected(0), false);
    }

    #[test]
    fn test_packed_project_header_round_trip() {
        let mut header = PackedProjectHeader::new(ProjectStatusV2::Created, 123, 456);

        assert_eq!(header.status(), ProjectStatusV2::Created);
        assert_eq!(header.created_at, 123);
        assert_eq!(header.deadline, 456);
        assert_eq!(header.has_deadline(), true);

        header.set_status(ProjectStatusV2::Completed);
        assert_eq!(header.status(), ProjectStatusV2::Completed);
    }
}
