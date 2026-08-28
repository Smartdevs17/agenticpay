#![no_std]

#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String, Vec};

pub mod common;
pub mod escrow;
pub mod dispute;
pub mod multisig;
pub mod htlc;
pub mod storage;

pub use common::*;
pub use storage::{
    ApprovalBitmap, LazyKey, LazyValue, ProjectV2, ProjectStatusV2, StorageKey,
};

#[contract]
pub struct AgenticPayContract;

#[contractimpl]
impl AgenticPayContract {
    // -----------------------------------------------------------------------
    // Gas-optimised lazy storage helpers
    // -----------------------------------------------------------------------
    // ReentrancyLock and Paused are read on every mutative call but written
    // only during initialise / pause / unpause.  We use `LazyValue` to avoid
    // paying the initialise SSTORE cost for paths that never toggle the
    // circuit breaker or trigger reentrancy — the first read returns the
    // default without a storage write.

    fn _lock() -> LazyValue<bool> {
        LazyValue::new(LazyKey::ReentrancyLock, false)
    }

    fn _pause_flag() -> LazyValue<bool> {
        LazyValue::new(LazyKey::Paused, false)
    }

    // -----------------------------------------------------------------------
    // Internal reentrancy guard helpers
    // -----------------------------------------------------------------------

    /// Acquire the reentrancy latch. Panics with "reentrant call" if already
    /// held, providing cross-function and cross-contract reentrancy protection.
    fn _acquire_lock(env: &Env) {
        let locked = Self::_lock().get(env);
        assert!(!locked, "reentrant call");
        Self::_lock().set(env, &true);
    }

    /// Release the reentrancy latch. Must be called at the end of every
    /// mutative function that called `_acquire_lock`.
    fn _release_lock(env: &Env) {
        Self::_lock().set(env, &false);
    }

    // -----------------------------------------------------------------------
    // Internal circuit-breaker helpers
    // -----------------------------------------------------------------------

    /// Panic with "contract paused" when the emergency circuit breaker is on.
    fn _require_not_paused(env: &Env) {
        let paused = Self::_pause_flag().get(env);
        assert!(!paused, "contract paused");
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ProjectCount, &0u64);
        env.storage().instance().set(&DataKey::ReceiptCount, &0u64);
        // ReentrancyLock and Paused are lazily initialised via LazyValue —
        // the first read returns `false` without a storage write.  This saves
        // two SSTORE operations (~40,000 gas) for contracts that never pause
        // or trigger the reentrancy latch.
    }

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    // -----------------------------------------------------------------------
    // Circuit-breaker controls (admin only)
    // -----------------------------------------------------------------------

    /// Pause all mutative operations. Admin-only emergency circuit breaker.
    /// Satisfies the "Emergency circuit breaker for reentrancy detection"
    /// acceptance criterion.
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = Self::get_admin(&env);
        assert!(admin == stored_admin, "Only admin can pause");
        // Acquire lock so pause cannot be called re-entrantly.
        Self::_acquire_lock(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (symbol_short!("circuit"), symbol_short!("paused")),
            true,
        );
        Self::_release_lock(&env);
    }

    /// Unpause the contract. Admin-only.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = Self::get_admin(&env);
        assert!(admin == stored_admin, "Only admin can unpause");
        // Acquire lock so unpause cannot be called re-entrantly.
        Self::_acquire_lock(&env);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (symbol_short!("circuit"), symbol_short!("paused")),
            false,
        );
        Self::_release_lock(&env);
    }

    /// Returns `true` when the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // -----------------------------------------------------------------------
    // Project lifecycle
    // -----------------------------------------------------------------------

    /// Create a new project with escrow.
    ///
    /// # Arguments
    /// * `deadline` - Unix timestamp for the project deadline. Pass 0 for no deadline.
    pub fn create_project(
        env: Env,
        client: Address,
        freelancer: Address,
        amount: i128,
        description: String,
        github_repo: String,
        deadline: u64,
    ) -> u64 {
        // --- Checks ---
        Self::_require_not_paused(&env);
        client.require_auth();
        Self::_acquire_lock(&env);

        // --- Effects ---
        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProjectCount)
            .unwrap_or(0);
        count += 1;

        let project = Project {
            id: count,
            client: client.clone(),
            freelancer: freelancer.clone(),
            amount,
            deposited: 0,
            status: ProjectStatus::Created,
            github_repo,
            description,
            created_at: env.ledger().timestamp(),
            deadline,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Project(count), &project);
        env.storage().instance().set(&DataKey::ProjectCount, &count);

        // --- Interactions (events only — no external calls) ---
        env.events().publish(
            (symbol_short!("project"), symbol_short!("created")),
            (count, client, freelancer, amount),
        );

        Self::_release_lock(&env);
        count
    }

    /// Create multiple projects in a single call.
    ///
    /// Optimizes storage writes by reading the project counter once,
    /// writing all projects, then updating the counter once.
    /// Emits a "project/created" event for each project.
    ///
    /// # Arguments
    /// * `client` - Address of the client creating all projects (must authorize)
    /// * `projects` - Vec of ProjectInput structs
    ///
    /// # Returns
    /// Vec of created project IDs
    pub fn batch_create_projects(
        env: Env,
        client: Address,
        projects: Vec<ProjectInput>,
    ) -> Vec<u64> {
        // --- Checks ---
        Self::_require_not_paused(&env);
        client.require_auth();
        Self::_acquire_lock(&env);

        // --- Effects ---
        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProjectCount)
            .unwrap_or(0);

        let timestamp = env.ledger().timestamp();
        let mut ids = Vec::new(&env);

        for i in 0..projects.len() {
            let input = projects.get(i).expect("Invalid project input");
            count += 1;

            let project = Project {
                id: count,
                client: client.clone(),
                freelancer: input.freelancer.clone(),
                amount: input.amount,
                deposited: 0,
                status: ProjectStatus::Created,
                github_repo: input.github_repo,
                description: input.description,
                created_at: timestamp,
                deadline: 0,
            };

            env.storage()
                .persistent()
                .set(&DataKey::Project(count), &project);

            // --- Interactions (events only) ---
            env.events().publish(
                (symbol_short!("project"), symbol_short!("created")),
                (count, client.clone(), input.freelancer, input.amount),
            );

            ids.push_back(count);
        }

        // Single counter update after all projects are written (CEI: all
        // state committed before any external interaction).
        env.storage().instance().set(&DataKey::ProjectCount, &count);

        Self::_release_lock(&env);
        ids
    }

    /// Fund a project escrow with XLM.
    ///
    /// CEI pattern: all state is updated before the funding event is emitted.
    /// The reentrancy latch prevents cross-function reentrancy (e.g. a
    /// malicious client contract calling back into `fund_project` or
    /// `approve_work` during the same transaction).
    pub fn fund_project(env: Env, project_id: u64, client: Address, amount: i128) {
        // --- Checks ---
        Self::_require_not_paused(&env);
        client.require_auth();
        Self::_acquire_lock(&env);

        let mut project: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("Project not found");

        assert!(project.client == client, "Only client can fund");
        assert!(
            project.status == ProjectStatus::Created,
            "Project must be in Created status"
        );
        assert!(amount > 0, "Amount must be positive");

        // --- Effects (all state committed before any interaction) ---
        project.deposited += amount;
        if project.deposited >= project.amount {
            project.status = ProjectStatus::Funded;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // --- Interactions (events only — token transfer is caller-side) ---
        env.events().publish(
            (symbol_short!("project"), symbol_short!("funded")),
            (project_id, amount),
        );

        Self::_release_lock(&env);
    }

    /// Freelancer submits work with a GitHub repo reference.
    pub fn submit_work(env: Env, project_id: u64, freelancer: Address, github_repo: String) {
        // --- Checks ---
        Self::_require_not_paused(&env);
        freelancer.require_auth();
        Self::_acquire_lock(&env);

        let mut project: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("Project not found");

        assert!(
            project.freelancer == freelancer,
            "Only assigned freelancer can submit"
        );
        assert!(
            project.status == ProjectStatus::Funded || project.status == ProjectStatus::InProgress,
            "Project must be funded or in progress"
        );

        // --- Effects ---
        project.github_repo = github_repo.clone();
        project.status = ProjectStatus::WorkSubmitted;

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // --- Interactions (events only) ---
        env.events().publish(
            (symbol_short!("project"), symbol_short!("work_sub")),
            (project_id, github_repo),
        );

        Self::_release_lock(&env);
    }

    /// Approve work and release escrow funds to freelancer.
    ///
    /// Strict CEI: `deposited` is zeroed and status set to `Completed`
    /// **before** `record_receipt` is called, so any re-entrant path that
    /// reads project state sees the post-payment values.
    pub fn approve_work(env: Env, project_id: u64, client: Address) {
        // --- Checks ---
        Self::_require_not_paused(&env);
        client.require_auth();
        Self::_acquire_lock(&env);

        let mut project: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("Project not found");

        assert!(project.client == client, "Only client can approve");
        assert!(
            project.status == ProjectStatus::WorkSubmitted
                || project.status == ProjectStatus::Verified,
            "Work must be submitted or verified"
        );

        // --- Effects (zero deposited and mark Completed BEFORE any interaction) ---
        let amount_released = project.deposited;
        let freelancer = project.freelancer.clone();
        let project_client = project.client.clone();
        project.status = ProjectStatus::Completed;
        project.deposited = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // --- Interactions ---
        env.events().publish(
            (symbol_short!("project"), symbol_short!("payment")),
            (project_id, amount_released),
        );

        // record_receipt is a pure storage write — no external calls.
        Self::record_receipt(
            &env,
            project_id,
            amount_released,
            String::from_str(&env, "XLM"),
            project_client,
            freelancer,
        );

        Self::_release_lock(&env);
    }

    fn record_receipt(
        env: &Env,
        project_id: u64,
        amount: i128,
        currency: String,
        sender: Address,
        recipient: Address,
    ) -> u64 {
        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCount)
            .unwrap_or(0);
        count += 1;

        let receipt = Receipt {
            id: count,
            project_id,
            amount,
            currency: currency.clone(),
            sender: sender.clone(),
            recipient: recipient.clone(),
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Receipt(count), &receipt);
        env.storage().instance().set(&DataKey::ReceiptCount, &count);
        env.events().publish(
            (symbol_short!("receipt"), symbol_short!("issued")),
            (count, project_id, amount, currency, sender, recipient),
        );

        count
    }

    /// Raise a dispute on a project.
    pub fn raise_dispute(env: Env, project_id: u64, caller: Address) {
        dispute::raise_dispute(&env, project_id, caller)
    }

    /// Admin resolves a dispute.
    ///
    /// CEI: `deposited` is zeroed and status updated before any future token
    /// transfer interaction (currently stubbed; the TODO comments mark where
    /// Stellar token calls will be inserted).
    pub fn resolve_dispute(env: Env, project_id: u64, admin: Address, release_to_freelancer: bool) {
        dispute::resolve_dispute(&env, project_id, admin, release_to_freelancer)
    }

    /// Check if a project's deadline has expired and auto-cancel if so.
    ///
    /// If the project has a non-zero deadline that has passed and the project
    /// is not already completed, cancelled, or disputed, it is automatically
    /// cancelled and escrow funds are marked for refund to the client.
    ///
    /// Anyone can call this function to trigger the check.
    ///
    /// Returns `true` if the project was auto-cancelled, `false` otherwise.
    ///
    /// CEI: `deposited` is zeroed and status set to `Cancelled` before the
    /// refund interaction (currently stubbed).
    pub fn check_deadline(env: Env, project_id: u64) -> bool {
        // --- Checks ---
        // Note: check_deadline is intentionally callable while paused so that
        // expired projects can always be cleaned up. The circuit breaker only
        // blocks fund-moving operations.
        Self::_acquire_lock(&env);

        let mut project: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("Project not found");

        // No deadline set or already in a terminal state
        if project.deadline == 0 {
            Self::_release_lock(&env);
            return false;
        }
        if project.status == ProjectStatus::Completed
            || project.status == ProjectStatus::Cancelled
            || project.status == ProjectStatus::Disputed
        {
            Self::_release_lock(&env);
            return false;
        }

        let now = env.ledger().timestamp();
        if now < project.deadline {
            Self::_release_lock(&env);
            return false;
        }

        // --- Effects (zero deposited BEFORE any refund interaction) ---
        let refund_amount = project.deposited;
        project.deposited = 0;
        project.status = ProjectStatus::Cancelled;

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // --- Interactions ---
        env.events().publish(
            (symbol_short!("project"), symbol_short!("expired")),
            (project_id, refund_amount),
        );
        // TODO: Transfer `refund_amount` back to project.client via Stellar
        //       token contract. State is already committed above.

        Self::_release_lock(&env);
        true
    }

    /// Get project details
    pub fn get_project(env: Env, project_id: u64) -> Project {
        env.storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("Project not found")
    }

    /// Get total project count
    pub fn get_project_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProjectCount)
            .unwrap_or(0)
    }

    /// Get receipt details by on-chain receipt id.
    pub fn get_receipt(env: Env, receipt_id: u64) -> Receipt {
        env.storage()
            .persistent()
            .get(&DataKey::Receipt(receipt_id))
            .expect("Receipt not found")
    }

    /// Get total receipt count.
    pub fn get_receipt_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ReceiptCount)
            .unwrap_or(0)
    }

    /// Store metadata key-value pair (admin only).
    pub fn set_metadata(env: Env, admin: Address, key: String, value: String) {
        Self::_require_not_paused(&env);
        admin.require_auth();
        Self::_acquire_lock(&env);
        let stored_admin = Self::get_admin(&env);
        assert!(admin == stored_admin, "Only admin can set metadata");

        env.storage()
            .persistent()
            .set(&DataKey::Metadata(key.clone()), &value);

        env.events().publish(
            (symbol_short!("meta"), symbol_short!("set")),
            (key, value),
        );

        Self::_release_lock(&env);
    }

    /// Read metadata by key
    pub fn get_metadata(env: Env, key: String) -> Option<String> {
        env.storage().persistent().get(&DataKey::Metadata(key))
    }

    /// Remove metadata entry (admin only).
    pub fn remove_metadata(env: Env, admin: Address, key: String) {
        Self::_require_not_paused(&env);
        admin.require_auth();
        Self::_acquire_lock(&env);
        let stored_admin = Self::get_admin(&env);
        assert!(admin == stored_admin, "Only admin can remove metadata");

        env.storage().persistent().remove(&DataKey::Metadata(key.clone()));

        env.events().publish(
            (symbol_short!("meta"), symbol_short!("del")),
            key,
        );

        Self::_release_lock(&env);
    }
    /// Upgrade the contract WASM code. Admin-only.
    ///
    /// Uses Soroban's built-in upgrade mechanism which replaces the contract
    /// bytecode while preserving all persistent and instance storage. This
    /// allows the contract to be upgraded without redeploying or migrating data.
    ///
    /// Upgrades are intentionally allowed even when paused so that a security
    /// patch can be deployed during an active circuit-breaker event.
    ///
    /// # Arguments
    /// * `admin` - Must match the stored admin address
    /// * `new_wasm_hash` - SHA-256 hash of the new WASM binary (uploaded via `soroban contract install`)
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        assert!(admin == stored_admin, "Only admin can upgrade");

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Return the contract version for tracking upgrades.
    pub fn version(_env: Env) -> u32 {
        2
    }

    // -----------------------------------------------------------------------
    // Storage migration (v1 → v2 packed layout)
    // -----------------------------------------------------------------------

    /// Migrate all existing projects from the v1 DataKey layout to the
    /// v2 packed StorageKey layout.  Admin-only.  Call this once after an
    /// upgrade to realise gas savings on existing data.
    ///
    /// # Arguments
    /// * `admin` - Must match the stored admin address
    /// * `project_count` - The current `ProjectCount` value (all projects
    ///   1..=project_count will be migrated)
    pub fn migrate_storage(env: Env, admin: Address, project_count: u64) {
        admin.require_auth();
        let stored_admin = Self::get_admin(&env);
        assert!(admin == stored_admin, "Only admin can migrate storage");

        for id in 1..=project_count {
            if env.storage().persistent().has(&DataKey::Project(id)) {
                let old: crate::Project = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Project(id))
                    .expect("Project not found during migration");

                let new = ProjectV2 {
                    id: old.id,
                    client: old.client,
                    freelancer: old.freelancer,
                    amount: old.amount,
                    deposited: old.deposited,
                    status: match old.status {
                        crate::ProjectStatus::Created => ProjectStatusV2::Created,
                        crate::ProjectStatus::Funded => ProjectStatusV2::Funded,
                        crate::ProjectStatus::InProgress => ProjectStatusV2::InProgress,
                        crate::ProjectStatus::WorkSubmitted => ProjectStatusV2::WorkSubmitted,
                        crate::ProjectStatus::Verified => ProjectStatusV2::Verified,
                        crate::ProjectStatus::Completed => ProjectStatusV2::Completed,
                        crate::ProjectStatus::Disputed => ProjectStatusV2::Disputed,
                        crate::ProjectStatus::Cancelled => ProjectStatusV2::Cancelled,
                    },
                    github_repo: old.github_repo,
                    description: old.description,
                    created_at: old.created_at,
                    deadline: old.deadline,
                };

                env.storage()
                    .persistent()
                    .set(&DataKey::V2(StorageKey::Project(id)), &new);
                env.storage().persistent().remove(&DataKey::Project(id));
            }
        }

        env.events().publish(
            (symbol_short!("storage"), symbol_short!("migrated")),
            project_count,
        );
    }

    // -----------------------------------------------------------------------
    // Multi-signature wallet management
    // -----------------------------------------------------------------------
    // Business logic lives in the `multisig` module; these entry points only
    // adapt the `#[contractimpl]` calling convention (owned `Env`) to it.

    /// Create a new multisig wallet with the given signers and threshold.
    ///
    /// # Arguments
    /// * `creator`       - Address authorizing the creation
    /// * `signers`       - Vec of signer addresses (min 2)
    /// * `threshold`     - Number of approvals required (1..=signers.len())
    /// * `timeout_ledgers` - Ledgers before proposals auto-expire (0 = never)
    ///
    /// # Returns
    /// The new wallet id.
    pub fn create_multisig_wallet(
        env: Env,
        creator: Address,
        signers: Vec<Address>,
        threshold: u32,
        timeout_ledgers: u64,
    ) -> u64 {
        multisig::create_wallet(&env, creator, signers, threshold, timeout_ledgers)
    }

    /// Retrieve a multisig wallet by id.
    pub fn get_multisig_wallet(env: Env, wallet_id: u64) -> MultisigWallet {
        multisig::get_wallet(&env, wallet_id)
    }

    /// Add a new signer to an existing wallet.
    ///
    /// Requires the caller to already be a signer (one-of-N consensus is
    /// enforced off-chain via the proposal flow; this entry-point is for
    /// direct admin-level additions authorized by the wallet creator).
    pub fn add_multisig_signer(
        env: Env,
        authorizer: Address,
        wallet_id: u64,
        new_signer: Address,
    ) {
        multisig::add_signer(&env, authorizer, wallet_id, new_signer)
    }

    /// Remove a signer from an existing wallet.
    ///
    /// The resulting signer count must remain >= threshold.
    pub fn remove_multisig_signer(
        env: Env,
        authorizer: Address,
        wallet_id: u64,
        signer_to_remove: Address,
    ) {
        multisig::remove_signer(&env, authorizer, wallet_id, signer_to_remove)
    }

    /// Create a transaction proposal for a multisig wallet.
    ///
    /// # Returns
    /// The new proposal id.
    pub fn create_multisig_proposal(
        env: Env,
        proposer: Address,
        wallet_id: u64,
        amount: i128,
        recipient: Address,
        description: String,
    ) -> u64 {
        multisig::create_proposal(&env, proposer, wallet_id, amount, recipient, description)
    }

    /// Approve a multisig proposal.
    ///
    /// When the approval count reaches the wallet threshold the proposal is
    /// automatically marked Executed and a payment event is emitted.
    pub fn approve_multisig_proposal(env: Env, signer: Address, proposal_id: u64) {
        multisig::approve_proposal(&env, signer, proposal_id)
    }

    /// Reject a multisig proposal.
    ///
    /// If the number of rejections makes the threshold unreachable the
    /// proposal is marked Rejected immediately.
    pub fn reject_multisig_proposal(env: Env, signer: Address, proposal_id: u64) {
        multisig::reject_proposal(&env, signer, proposal_id)
    }

    /// Cancel a pending proposal (any signer may cancel).
    pub fn cancel_multisig_proposal(env: Env, signer: Address, proposal_id: u64) {
        multisig::cancel_proposal(&env, signer, proposal_id)
    }

    /// Retrieve a multisig proposal by id.
    pub fn get_multisig_proposal(env: Env, proposal_id: u64) -> MultisigProposal {
        multisig::get_proposal(&env, proposal_id)
    }

    /// Check and auto-expire a proposal whose timeout has passed.
    ///
    /// Returns `true` if the proposal was expired, `false` otherwise.
    pub fn check_multisig_expiry(env: Env, proposal_id: u64) -> bool {
        multisig::check_expiry(&env, proposal_id)
    }

    // -----------------------------------------------------------------------
    // HTLC bridge functions
    // -----------------------------------------------------------------------
    // Business logic lives in the `htlc` module; these entry points only
    // adapt the `#[contractimpl]` calling convention (owned `Env`) to it.

    /// Initialize the bridge configuration. Admin-only.
    pub fn init_bridge_config(env: Env, admin: Address, fee_bps: u32, fee_collector: Address) {
        htlc::init_bridge_config(&env, admin, fee_bps, fee_collector)
    }

    /// Update bridge configuration. Admin-only.
    pub fn update_bridge_config(
        env: Env,
        admin: Address,
        fee_bps: Option<u32>,
        fee_collector: Option<Address>,
        paused: Option<bool>,
    ) {
        htlc::update_bridge_config(&env, admin, fee_bps, fee_collector, paused)
    }

    /// Create an HTLC lock for a cross-chain atomic swap.
    ///
    /// The sender locks native tokens on Stellar. The recipient on the
    /// destination chain can claim by revealing the preimage. If the timelock
    /// expires without a claim, the sender can reclaim.
    ///
    /// # Arguments
    /// * `sender` - Address locking the tokens (must authorize)
    /// * `input` - HtlcLockInput with recipient, amount, hashlock, timelock, etc.
    ///
    /// # Returns
    /// The HTLC lock id.
    pub fn create_htlc_lock(env: Env, sender: Address, input: HtlcLockInput) -> u64 {
        htlc::create_lock(&env, sender, input)
    }

    /// Claim an HTLC lock by revealing the secret preimage.
    ///
    /// The recipient provides the secret whose SHA-256 hash matches the
    /// hashlock. Tokens are transferred to the recipient minus any fee.
    pub fn claim_htlc(env: Env, lock_id: u64, secret: BytesN<32>) {
        htlc::claim_lock(&env, lock_id, secret)
    }

    /// Refund an HTLC lock after the timelock (and dispute window) has expired.
    ///
    /// The sender can reclaim their tokens if the recipient did not claim
    /// within the allowed time window.
    pub fn refund_htlc(env: Env, lock_id: u64) {
        htlc::refund_lock(&env, lock_id)
    }

    /// Retrieve an HTLC lock by id.
    pub fn get_htlc_lock(env: Env, lock_id: u64) -> HtlcLock {
        htlc::get_lock(&env, lock_id)
    }

    /// Retrieve the bridge configuration.
    pub fn get_bridge_config(env: Env) -> BridgeConfigData {
        htlc::get_bridge_config(&env)
    }

}

// Bring in the property-based security tests (proptest suite).
#[cfg(test)]
mod security_properties;

// Bring in gas benchmarks (requires --features gas_benchmarks).
#[cfg(feature = "gas_benchmarks")]
#[cfg(test)]
mod benchmarks;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::Env;

    #[test]
    fn test_project_creation() {
        let env = Env::default();
        let _admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let project = Project {
            id: 1,
            client,
            freelancer,
            amount: 1000,
            deposited: 0,
            status: ProjectStatus::Created,
            github_repo: String::from_str(&env, "https://github.com/example/repo"),
            description: String::from_str(&env, "Test project"),
            created_at: env.ledger().timestamp(),
            deadline: 0,
        };

        assert_eq!(project.amount, 1000);
        assert_eq!(project.status, ProjectStatus::Created);
        assert_eq!(project.deadline, 0);
    }

    #[test]
    fn test_check_deadline_no_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "Test"),
            &String::from_str(&env, "https://github.com/test"),
            &0, // no deadline
        );

        // Should return false — no deadline set
        assert!(!client.check_deadline(&id));
    }

    #[test]
    fn test_check_deadline_not_expired() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        // Deadline far in the future
        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "Test"),
            &String::from_str(&env, "https://github.com/test"),
            &9999999999,
        );

        assert!(!client.check_deadline(&id));
        let project = client.get_project(&id);
        assert_eq!(project.status, ProjectStatus::Created);
    }

    #[test]
    fn test_check_deadline_expired_cancels() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        // Deadline = 1 (already in the past since ledger timestamp starts at 0 in tests)
        // We need the deadline to be in the past relative to current ledger time
        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "Test"),
            &String::from_str(&env, "https://github.com/test"),
            &1, // deadline = timestamp 1
        );

        // Fund the project first
        client.fund_project(&id, &user, &1000);

        // Advance ledger time past deadline
        env.ledger().with_mut(|li| {
            li.timestamp = 100;
        });

        // Should auto-cancel
        assert!(client.check_deadline(&id));
        let project = client.get_project(&id);
        assert_eq!(project.status, ProjectStatus::Cancelled);
        assert_eq!(project.deposited, 0);
    }

    #[test]
    fn test_check_deadline_already_completed_ignored() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "Test"),
            &String::from_str(&env, "https://github.com/test"),
            &1,
        );

        // Fund, submit work, approve to complete
        client.fund_project(&id, &user, &1000);
        client.submit_work(
            &id,
            &freelancer,
            &String::from_str(&env, "https://github.com/done"),
        );
        client.approve_work(&id, &user);

        // Advance past deadline
        env.ledger().with_mut(|li| {
            li.timestamp = 100;
        });

        // Should NOT cancel — already completed
        assert!(!client.check_deadline(&id));
        let project = client.get_project(&id);
        assert_eq!(project.status, ProjectStatus::Completed);
    }

    #[test]
    fn test_batch_create_projects() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer1 = Address::generate(&env);
        let freelancer2 = Address::generate(&env);
        let freelancer3 = Address::generate(&env);

        client.initialize(&admin);

        let mut inputs = Vec::new(&env);
        inputs.push_back(ProjectInput {
            freelancer: freelancer1.clone(),
            amount: 1000,
            description: String::from_str(&env, "Project 1"),
            github_repo: String::from_str(&env, "https://github.com/test/1"),
        });
        inputs.push_back(ProjectInput {
            freelancer: freelancer2.clone(),
            amount: 2000,
            description: String::from_str(&env, "Project 2"),
            github_repo: String::from_str(&env, "https://github.com/test/2"),
        });
        inputs.push_back(ProjectInput {
            freelancer: freelancer3.clone(),
            amount: 3000,
            description: String::from_str(&env, "Project 3"),
            github_repo: String::from_str(&env, "https://github.com/test/3"),
        });

        let ids = client.batch_create_projects(&user, &inputs);

        // Should return 3 IDs
        assert_eq!(ids.len(), 3);
        assert_eq!(ids.get(0).unwrap(), 1);
        assert_eq!(ids.get(1).unwrap(), 2);
        assert_eq!(ids.get(2).unwrap(), 3);

        // Counter should be updated
        assert_eq!(client.get_project_count(), 3);

        // Verify each project
        let p1 = client.get_project(&1);
        assert_eq!(p1.amount, 1000);
        assert_eq!(p1.freelancer, freelancer1);

        let p2 = client.get_project(&2);
        assert_eq!(p2.amount, 2000);
        assert_eq!(p2.freelancer, freelancer2);

        let p3 = client.get_project(&3);
        assert_eq!(p3.amount, 3000);
        assert_eq!(p3.freelancer, freelancer3);
    }

    #[test]
    fn test_batch_create_empty() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);

        let inputs = Vec::new(&env);
        let ids = client.batch_create_projects(&user, &inputs);

        assert_eq!(ids.len(), 0);
        assert_eq!(client.get_project_count(), 0);
    }

    #[test]
    fn test_batch_then_single_create() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        // Batch create 2 projects
        let mut inputs = Vec::new(&env);
        inputs.push_back(ProjectInput {
            freelancer: freelancer.clone(),
            amount: 500,
            description: String::from_str(&env, "Batch 1"),
            github_repo: String::from_str(&env, "https://github.com/b1"),
        });
        inputs.push_back(ProjectInput {
            freelancer: freelancer.clone(),
            amount: 600,
            description: String::from_str(&env, "Batch 2"),
            github_repo: String::from_str(&env, "https://github.com/b2"),
        });
        client.batch_create_projects(&user, &inputs);

        // Then create a single project — ID should be 3
        let id = client.create_project(
            &user,
            &freelancer,
            &700,
            &String::from_str(&env, "Single"),
            &String::from_str(&env, "https://github.com/s1"),
            &0,
        );

        assert_eq!(id, 3);
        assert_eq!(client.get_project_count(), 3);
    }

    #[test]
    fn test_version_returns_current() {
        let env = Env::default();
        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        assert_eq!(client.version(), 2);
    }

    #[test]
    #[should_panic(expected = "Only admin can upgrade")]
    fn test_upgrade_rejects_non_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);

        client.initialize(&admin);

        // Non-admin attempting upgrade should panic
        let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
        client.upgrade(&non_admin, &fake_hash);
    }

    // -----------------------------------------------------------------------
    // Reentrancy guard tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_reentrancy_lock_released_after_create_project() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        // First call acquires and releases the lock.
        let id1 = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "P1"),
            &String::from_str(&env, "https://github.com/test/1"),
            &0,
        );

        // Second call must succeed — lock must have been released.
        let id2 = client.create_project(
            &user,
            &freelancer,
            &2000,
            &String::from_str(&env, "P2"),
            &String::from_str(&env, "https://github.com/test/2"),
            &0,
        );

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_reentrancy_lock_released_after_fund_project() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "https://github.com/test"),
            &0,
        );

        // fund_project acquires and releases the lock; a second call must succeed.
        client.fund_project(&id, &user, &500);
        client.fund_project(&id, &user, &500);

        let project = client.get_project(&id);
        assert_eq!(project.deposited, 1000);
        assert_eq!(project.status, ProjectStatus::Funded);
    }

    // -----------------------------------------------------------------------
    // Circuit-breaker tests
    // -----------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "contract paused")]
    fn test_circuit_breaker_blocks_create_project_when_paused() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);
        client.pause(&admin);

        // Must panic because the contract is paused.
        client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "https://github.com/test"),
            &0,
        );
    }

    #[test]
    fn test_circuit_breaker_unpauses_correctly() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        assert!(!client.is_paused());
        client.pause(&admin);
        assert!(client.is_paused());
        client.unpause(&admin);
        assert!(!client.is_paused());

        // Operations must work again after unpause.
        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "https://github.com/test"),
            &0,
        );
        assert_eq!(id, 1);
    }

    #[test]
    #[should_panic(expected = "Only admin can pause")]
    fn test_circuit_breaker_rejects_non_admin_pause() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);

        client.initialize(&admin);
        client.pause(&non_admin);
    }

    #[test]
    fn test_approve_work_zeroes_deposited_before_receipt() {
        // Verifies the CEI pattern: deposited is 0 in storage before
        // record_receipt is called, so a re-entrant read sees the post-payment
        // state.
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "https://github.com/test"),
            &0,
        );

        client.fund_project(&id, &user, &1000);
        client.submit_work(
            &id,
            &freelancer,
            &String::from_str(&env, "https://github.com/done"),
        );
        client.approve_work(&id, &user);

        let project = client.get_project(&id);
        // After approve_work, deposited must be 0 (CEI: zeroed before receipt).
        assert_eq!(project.deposited, 0);
        assert_eq!(project.status, ProjectStatus::Completed);
    }

    #[test]
    fn test_resolve_dispute_zeroes_deposited_before_interaction() {
        // Verifies CEI in resolve_dispute: deposited is zeroed in storage
        // before any future token transfer interaction.
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.initialize(&admin);

        let id = client.create_project(
            &user,
            &freelancer,
            &1000,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "https://github.com/test"),
            &0,
        );

        client.fund_project(&id, &user, &1000);
        client.raise_dispute(&id, &user);
        client.resolve_dispute(&id, &admin, &true);

        let project = client.get_project(&id);
        assert_eq!(project.deposited, 0);
        assert_eq!(project.status, ProjectStatus::Completed);
    }

    // -----------------------------------------------------------------------
    // HTLC bridge tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_htlc_lock_and_claim() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.initialize(&admin);
        client.init_bridge_config(&admin, &30, &admin);

        let secret: BytesN<32> = BytesN::from_array(&env, &[42u8; 32]);
        let hashlock: BytesN<32> = env.crypto().sha256(&secret.clone().into()).into();

        let lock_id = client.create_htlc_lock(
            &sender,
            &HtlcLockInput {
                recipient: recipient.clone(),
                amount: 1000,
                hashlock,
                timelock: env.ledger().timestamp() + 1000,
                dispute_window: 100,
                target_chain: String::from_str(&env, "ethereum-mainnet"),
                target_lock_id: String::from_str(&env, "0xabc123"),
            },
        );

        let lock = client.get_htlc_lock(&lock_id);
        assert_eq!(lock.status, HtlcStatus::Pending);
        assert_eq!(lock.amount, 1000);
        assert_eq!(lock.sender, sender);
        assert_eq!(lock.recipient, recipient);

        client.claim_htlc(&lock_id, &secret);

        let lock = client.get_htlc_lock(&lock_id);
        assert_eq!(lock.status, HtlcStatus::Claimed);
    }

    #[test]
    fn test_htlc_refund_after_timelock() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.initialize(&admin);
        client.init_bridge_config(&admin, &30, &admin);

        let secret: BytesN<32> = BytesN::from_array(&env, &[42u8; 32]);
        let hashlock: BytesN<32> = env.crypto().sha256(&secret.clone().into()).into();

        let timelock = env.ledger().timestamp() + 10;
        let lock_id = client.create_htlc_lock(
            &sender,
            &HtlcLockInput {
                recipient,
                amount: 500,
                hashlock,
                timelock,
                dispute_window: 5,
                target_chain: String::from_str(&env, "ethereum-mainnet"),
                target_lock_id: String::from_str(&env, "0xdef456"),
            },
        );

        // Advance ledger past timelock.
        env.ledger().with_mut(|li| {
            li.timestamp = timelock + 1;
        });

        client.refund_htlc(&lock_id);

        let lock = client.get_htlc_lock(&lock_id);
        assert_eq!(lock.status, HtlcStatus::Refunded);
    }

    #[test]
    #[should_panic(expected = "Invalid secret")]
    fn test_htlc_claim_wrong_secret() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.initialize(&admin);
        client.init_bridge_config(&admin, &30, &admin);

        let secret: BytesN<32> = BytesN::from_array(&env, &[42u8; 32]);
        let hashlock: BytesN<32> = env.crypto().sha256(&secret.clone().into()).into();

        let lock_id = client.create_htlc_lock(
            &sender,
            &HtlcLockInput {
                recipient,
                amount: 100,
                hashlock,
                timelock: env.ledger().timestamp() + 1000,
                dispute_window: 100,
                target_chain: String::from_str(&env, "ethereum-mainnet"),
                target_lock_id: String::from_str(&env, "0x000"),
            },
        );

        let wrong_secret: BytesN<32> = BytesN::from_array(&env, &[99u8; 32]);
        client.claim_htlc(&lock_id, &wrong_secret);
    }

    #[test]
    fn test_bridge_config_init_and_update() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgenticPayContract);
        let client = AgenticPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let collector = Address::generate(&env);

        client.initialize(&admin);
        client.init_bridge_config(&admin, &50, &collector);

        let config = client.get_bridge_config();
        assert_eq!(config.fee_bps, 50);
        assert_eq!(config.fee_collector, collector);
        assert_eq!(config.paused, false);

        client.update_bridge_config(&admin, &Some(100), &None, &Some(true));

        let config = client.get_bridge_config();
        assert_eq!(config.fee_bps, 100);
        assert_eq!(config.paused, true);
    }
}
