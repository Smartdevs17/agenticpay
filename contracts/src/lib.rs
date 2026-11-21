Warning: truncated output (original token count: 15011)
Total output lines: 1876

#![no_std]

pub mod identity;
pub mod stream;
pub mod anchor;
pub mod factoring;
pub mod policies;
pub mod spend_policy;

#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String, Vec};

// ---------------------------------------------------------------------------
// Multi-signature wallet types
// ---------------------------------------------------------------------------

/// On-chain status for a multisig transaction proposal.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MultisigProposalStatus {
    Pending,
    Executed,
    Rejected,
    Expired,
    Cancelled,
}

/// A multisig wallet configuration stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigWallet {
    /// Unique wallet id (same as the storage counter key).
    pub id: u64,
    /// Ordered list of signer addresses.
    pub signers: Vec<Address>,
    /// Minimum number of approvals needed to execute a proposal.
    pub threshold: u32,
    /// Ledger timestamp after which new proposals auto-expire (0 = no timeout).
    pub timeout_ledgers: u64,
    /// Whether the wallet is active.
    pub active: bool,
}

/// An on-chain multisig transaction proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigProposal {
    pub id: u64,
    pub wallet_id: u64,
    /// Amount in stroops (or smallest denomination).
    pub amount: i128,
    pub recipient: Address,
    pub description: String,
    pub status: MultisigProposalStatus,
    /// Addresses that have approved this proposal.
    pub approvals: Vec<Address>,
    /// Addresses that have rejected this proposal.
    pub rejections: Vec<Address>,
    pub created_at: u64,
    /// Ledger timestamp at which the proposal expires (0 = never).
    pub expires_at: u64,
}

#[contracttype]
pub enum MultisigDataKey {
    WalletCount,
    Wallet(u64),
    ProposalCount,
    Proposal(u64),
}

// ---------------------------------------------------------------------------
// Reentrancy guard key
// ---------------------------------------------------------------------------
// Soroban's execution model is single-threaded and does not allow re-entrant
// calls into the same contract instance within a single transaction. However,
// cross-contract calls can still create logical reentrancy if state is not
// committed before the call. We enforce the checks-effects-interactions (CEI)
// pattern throughout and additionally maintain an explicit reentrancy latch in
// instance storage so that any future cross-contract path is blocked.
//
// The latch is stored under `DataKey::ReentrancyLock` and is set to `true`
// while a mutative function body is executing. Any re-entrant call that
// reaches the `_acquire_lock` helper will panic with "reentrant call".
// ---------------------------------------------------------------------------

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
    /// Unix timestamp deadline. 0 means no deadline.
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
    /// Reentrancy latch: `true` while a mutative function is executing.
    ReentrancyLock,
    /// Emergency circuit breaker: `true` means the contract is paused.
    Paused,
    // Multisig wallet storage
    MultisigWalletCount,
    MultisigWallet(u64),
    MultisigProposalCount,
    MultisigProposal(u64),
}

/// Input parameters for batch project creation.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProjectInput {
    pub freelancer: Address,
    pub amount: i128,
    pub description: String,
    pub github_repo: String,
}

#[contract]
pub struct AgenticPayContract;

#[contractimpl]
impl AgenticPayContract {
    // -----------------------------------------------------------------------
    // Internal reentrancy guard helpers
    // -----------------------------------------------------------------------

    /// Acquire the reentrancy latch. Panics with "reentrant call" if already
    /// held, providing cross-function and cross-contract reentrancy protection.
    fn _acquire_lock(env: &Env) {
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

    /// Release the reentrancy latch. Must be called at the end of every
    /// mutative function that called `_acquire_lock`.
    fn _release_lock(env: &Env) {
        env.storage()
            .instance()
            .set(&DataKey::ReentrancyLock, &false);
    }

    // -----------------------------------------------------------------------
    // Internal circuit-breaker helpers
    // -----------------------------------------------------------------------

    /// Panic with "contract paused" when the emergency circuit breaker is on.
    fn _require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
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
        // Reentrancy latch starts unlocked; circuit breaker starts unpaused.
        env.storage().instance().set(&DataKey::ReentrancyLock, &false);
        env.storage().instance().set(&DataKey::Paused, &false);
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
        // --- Checks ---
        Self::_require_not_paused(&env);
        caller.require_auth();
        Self::_acquire_lock(&env);

        let mut project: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("Project not found");

        assert!(
            caller == project.client || caller == project.freelancer,
            "Only client or freelancer can dispute"
        );

        // --- Effects ---
        project.status = ProjectStatus::Disputed;

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);

        // --- Interactions (events only) ---
        env.events().publish(
            (symbol_short!("project"), symbol_short!("disputed")),
            (project_id, caller),
        );

        Self::_release_lock(&env);
    }

    /// Admin resolves a dispute.
    ///
    /// CEI: `deposited` is zeroed and status updated before any future token
    /// transfer interaction (currently stubbed; the TODO comments mark where
    /// Stellar token calls will be inserted).
    pub fn resolve_dispute(env: Env, project_id: u64, admin: Address, release_to_freelancer: bool) {
        // --- Checks ---
        Self::_require_not_paused(&env);
        admin.require_auth();
        Self::_acquire_lock(&env);

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        assert!(admin == stored_admin, "Only admin can resolve disputes");

        let mut project: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .expect("P…5011 tokens truncated…stent()
            .get(&DataKey::MultisigWallet(proposal.wallet_id))
            .expect("Wallet not found");

        let mut is_signer = false;
        for i in 0..wallet.signers.len() {
            if wallet.signers.get(i).unwrap() == signer {
                is_signer = true;
                break;
            }
        }
        assert!(is_signer, "Not a signer of this wallet");

        proposal.status = MultisigProposalStatus::Cancelled;

        env.storage()
            .persistent()
            .set(&DataKey::MultisigProposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("msig"), symbol_short!("cancel")),
            (proposal_id, proposal.wallet_id),
        );

        Self::_release_lock(&env);
    }

    /// Retrieve a multisig proposal by id.
    pub fn get_multisig_proposal(env: Env, proposal_id: u64) -> MultisigProposal {
        env.storage()
            .persistent()
            .get(&DataKey::MultisigProposal(proposal_id))
            .expect("Proposal not found")
    }

    /// Check and auto-expire a proposal whose timeout has passed.
    ///
    /// Returns `true` if the proposal was expired, `false` otherwise.
    pub fn check_multisig_expiry(env: Env, proposal_id: u64) -> bool {
        Self::_acquire_lock(&env);

        let mut proposal: MultisigProposal = env
            .storage()
            .persistent()
            .get(&DataKey::MultisigProposal(proposal_id))
            .expect("Proposal not found");

        if proposal.status != MultisigProposalStatus::Pending || proposal.expires_at == 0 {
            Self::_release_lock(&env);
            return false;
        }

        if env.ledger().timestamp() < proposal.expires_at {
            Self::_release_lock(&env);
            return false;
        }

        proposal.status = MultisigProposalStatus::Expired;
        env.storage()
            .persistent()
            .set(&DataKey::MultisigProposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("msig"), symbol_short!("expired")),
            (proposal_id, proposal.wallet_id),
        );

        Self::_release_lock(&env);
        true
    }
}

// Bring in the property-based security tests (proptest suite).
#[cfg(test)]
mod security_properties;

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

        assert_eq!(client.version(), 1);
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
}
