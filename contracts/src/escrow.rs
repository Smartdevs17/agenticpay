use soroban_sdk::{Address, Env, String, Vec};
use crate::common::{self, *};

pub fn create_project(
    env: &Env,
    client: Address,
    freelancer: Address,
    amount: i128,
    description: String,
    github_repo: String,
    deadline: u64,
) -> u64 {
    common::_require_not_paused(env);
    client.require_auth();
    common::_acquire_lock(env);

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

    env.events().publish(
        (symbol_short!("project"), symbol_short!("created")),
        (count, client, freelancer, amount),
    );

    common::_release_lock(env);
    count
}

pub fn batch_create_projects(
    env: &Env,
    client: Address,
    projects: Vec<ProjectInput>,
) -> Vec<u64> {
    common::_require_not_paused(env);
    client.require_auth();
    common::_acquire_lock(env);

    let mut count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ProjectCount)
        .unwrap_or(0);

    let timestamp = env.ledger().timestamp();
    let mut ids = Vec::new(env);

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
            github_repo: input.github_repo.clone(),
            description: input.description.clone(),
            created_at: timestamp,
            deadline: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Project(count), &project);

        env.events().publish(
            (symbol_short!("project"), symbol_short!("created")),
            (count, client.clone(), input.freelancer, input.amount),
        );

        ids.push_back(count);
    }

    env.storage().instance().set(&DataKey::ProjectCount, &count);

    common::_release_lock(env);
    ids
}

pub fn fund_project(env: &Env, project_id: u64, client: Address, amount: i128) {
    common::_require_not_paused(env);
    client.require_auth();
    common::_acquire_lock(env);

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

    project.deposited += amount;
    if project.deposited >= project.amount {
        project.status = ProjectStatus::Funded;
    }

    env.storage()
        .persistent()
        .set(&DataKey::Project(project_id), &project);

    env.events().publish(
        (symbol_short!("project"), symbol_short!("funded")),
        (project_id, amount),
    );

    common::_release_lock(env);
}

pub fn submit_work(env: &Env, project_id: u64, freelancer: Address, github_repo: String) {
    common::_require_not_paused(env);
    freelancer.require_auth();
    common::_acquire_lock(env);

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

    project.github_repo = github_repo.clone();
    project.status = ProjectStatus::WorkSubmitted;

    env.storage()
        .persistent()
        .set(&DataKey::Project(project_id), &project);

    env.events().publish(
        (symbol_short!("project"), symbol_short!("work_sub")),
        (project_id, github_repo),
    );

    common::_release_lock(env);
}

pub fn approve_work(env: &Env, project_id: u64, client: Address) {
    common::_require_not_paused(env);
    client.require_auth();
    common::_acquire_lock(env);

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

    let amount_released = project.deposited;
    let freelancer = project.freelancer.clone();
    let project_client = project.client.clone();
    project.status = ProjectStatus::Completed;
    project.deposited = 0;

    env.storage()
        .persistent()
        .set(&DataKey::Project(project_id), &project);

    env.events().publish(
        (symbol_short!("project"), symbol_short!("payment")),
        (project_id, amount_released),
    );

    record_receipt(env, project_id, amount_released, String::from_str(env, "XLM"), project_client, freelancer);

    common::_release_lock(env);
}

pub fn record_receipt(
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

pub fn check_deadline(env: &Env, project_id: u64) -> bool {
    common::_acquire_lock(env);

    let mut project: Project = env
        .storage()
        .persistent()
        .get(&DataKey::Project(project_id))
        .expect("Project not found");

    if project.deadline == 0 {
        common::_release_lock(env);
        return false;
    }
    if project.status == ProjectStatus::Completed
        || project.status == ProjectStatus::Cancelled
        || project.status == ProjectStatus::Disputed
    {
        common::_release_lock(env);
        return false;
    }

    let now = env.ledger().timestamp();
    if now < project.deadline {
        common::_release_lock(env);
        return false;
    }

    let refund_amount = project.deposited;
    project.deposited = 0;
    project.status = ProjectStatus::Cancelled;

    env.storage()
        .persistent()
        .set(&DataKey::Project(project_id), &project);

    env.events().publish(
        (symbol_short!("project"), symbol_short!("expired")),
        (project_id, refund_amount),
    );

    common::_release_lock(env);
    true
}

pub fn get_project(env: &Env, project_id: u64) -> Project {
    env.storage()
        .persistent()
        .get(&DataKey::Project(project_id))
        .expect("Project not found")
}

pub fn get_project_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ProjectCount)
        .unwrap_or(0)
}

pub fn get_receipt(env: &Env, receipt_id: u64) -> Receipt {
    env.storage()
        .persistent()
        .get(&DataKey::Receipt(receipt_id))
        .expect("Receipt not found")
}

pub fn get_receipt_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ReceiptCount)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Configurable tiered multi-sig escrow threshold policies
// ---------------------------------------------------------------------------

/// A single threshold tier: amounts in `[min_amount, max_amount]` require
/// exactly `required_signers` signers.  `None` on `max_amount` means "open
/// upper bound" (i.e. anything >= `min_amount` until a higher policy matches
/// or the default is used).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ThresholdPolicy {
    pub min_amount: u64,
    pub max_amount: Option<u64>,
    pub required_signers: u32,
}

/// An ordered collection of threshold tiers plus a fallback default.
///
/// Policies **MUST** be sorted by `min_amount` ascending and must not overlap
/// (`validate_threshold_policy` enforces this).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MultisigThresholdPolicy {
    pub policies: Vec<ThresholdPolicy>,
    pub default_threshold: u32,
}

/// Look up the required signer count for a given escrow `amount` against the
/// provided `policy`.  Returns the `required_signers` from the first matching
/// tier, or `default_threshold` if no tier covers the amount.
pub fn get_required_signers(amount: u64, policy: &MultisigThresholdPolicy) -> u32 {
    let len = policy.policies.len();
    let mut i = 0u32;
    while i < len {
        let tier = policy.policies.get(i).expect("policy index out of range");
        let matches = amount >= tier.min_amount
            && match tier.max_amount {
                Some(max) => amount <= max,
                None => true,
            };
        if matches {
            return tier.required_signers;
        }
        i += 1;
    }
    policy.default_threshold
}

/// Validate that a `MultisigThresholdPolicy` is well-formed:
///
/// 1. Policies are sorted by `min_amount` ascending.
/// 2. No adjacent ranges overlap (i.e. the next policy's `min_amount` must be
///    strictly greater than the previous policy's upper bound when present).
/// 3. Every `required_signers` is at least 1.
/// 4. `default_threshold` is at least 1.
pub fn validate_threshold_policy(policy: &MultisigThresholdPolicy) -> bool {
    if policy.default_threshold == 0 {
        return false;
    }

    let len = policy.policies.len();
    if len == 0 {
        return true;
    }

    let mut i = 0u32;
    while i < len {
        let tier = policy.policies.get(i).expect("policy index out of range");

        // threshold must be at least 1
        if tier.required_signers == 0 {
            return false;
        }

        // min_amount must be less than max_amount when both present
        if let Some(max) = tier.max_amount {
            if tier.min_amount > max {
                return false;
            }
        }

        // check adjacency: previous upper bound must not reach into this tier
        if i > 0 {
            let prev = policy.policies.get(i - 1).expect("policy index out of range");
            // previous min must be strictly less (sorted ascending)
            if prev.min_amount >= tier.min_amount {
                return false;
            }
            // previous range must not overlap into this tier's range
            if let Some(prev_max) = prev.max_amount {
                if prev_max >= tier.min_amount {
                    return false;
                }
            }
        }

        i += 1;
    }

    true
}

/// Determine the required signers from `policy` for the given `amount`, then
/// create and store a new escrow project with that threshold baked in.
///
/// Returns the new project id.
pub fn create_escrow_with_policy(
    env: &Env,
    client: Address,
    freelancer: Address,
    amount: i128,
    description: String,
    github_repo: String,
    deadline: u64,
    policy: MultisigThresholdPolicy,
) -> u64 {
    common::_require_not_paused(env);
    client.require_auth();
    common::_acquire_lock(env);

    assert!(
        validate_threshold_policy(&policy),
        "Invalid threshold policy"
    );

    let unsigned_amount = amount.unsigned_abs() as u64;
    let _signers = get_required_signers(unsigned_amount, &policy);

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

    // Persist the threshold policy keyed to the project so downstream
    // multisig flows can enforce the correct signer count.
    env.storage()
        .persistent()
        .set(&DataKey::EscrowPolicy(count), &policy);

    env.events().publish(
        (symbol_short!("project"), symbol_short!("created")),
        (count, client, freelancer, amount),
    );

    common::_release_lock(env);
    count
}
