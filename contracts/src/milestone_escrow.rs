use soroban_sdk::{Address, Bytes, Env, String, symbol_short};
use crate::common::{self, *};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u64,
    pub project_id: u64,
    pub amount: i128,
    pub description: String,
    pub deadline: u64,
    pub attestation_provider: Address,
    pub attestation_proof: Option<Bytes>,
    pub status: MilestoneStatus,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MilestoneStatus {
    Pending = 0,
    Attested = 1,
    Unlocked = 2,
    Disputed = 3,
    Cancelled = 4,
}

pub fn create_milestone(
    env: &Env,
    project_id: u64,
    client: Address,
    amount: i128,
    description: String,
    deadline: u64,
    attestation_provider: Address,
) -> u64 {
    common::_require_not_paused(env);
    client.require_auth();
    common::_acquire_lock(env);

    let project: Project = env
        .storage()
        .persistent()
        .get(&DataKey::Project(project_id))
        .expect("Project not found");

    assert!(project.client == client, "Only project client can create milestones");
    assert!(amount > 0, "Milestone amount must be positive");
    assert!(deadline > env.ledger().timestamp(), "Deadline must be in the future");

    let mut milestone_count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::Metadata(String::from_str(env, "milestone_count")))
        .unwrap_or_else(|| String::from_str(env, "0"));

    let count_num: u64 = milestone_count.to_string().parse().unwrap_or(0);
    let new_count = count_num + 1;

    let milestone = Milestone {
        id: new_count,
        project_id,
        amount,
        description: description.clone(),
        deadline,
        attestation_provider: attestation_provider.clone(),
        attestation_proof: None,
        status: MilestoneStatus::Pending,
        created_at: env.ledger().timestamp(),
    };

    env.storage()
        .persistent()
        .set(&DataKey::Metadata(String::from_str(env, &format!("milestone_{}", new_count))),
             &milestone);

    env.storage()
        .instance()
        .set(&DataKey::Metadata(String::from_str(env, "milestone_count")),
             &String::from_str(env, &new_count.to_string()));

    env.events().publish(
        (symbol_short!("milestone"), symbol_short!("created")),
        (new_count, project_id, amount, description),
    );

    common::_release_lock(env);
    new_count
}

pub fn submit_attestation(
    env: &Env,
    milestone_id: u64,
    attestation_provider: Address,
    proof: Bytes,
) {
    common::_require_not_paused(env);
    attestation_provider.require_auth();
    common::_acquire_lock(env);

    let milestone_key = String::from_str(env, &format!("milestone_{}", milestone_id));

    let mut milestone: Milestone = env
        .storage()
        .persistent()
        .get(&DataKey::Metadata(milestone_key.clone()))
        .expect("Milestone not found");

    assert!(milestone.attestation_provider == attestation_provider, "Only designated provider can attest");
    assert!(milestone.status == MilestoneStatus::Pending, "Milestone already attested or resolved");
    assert!(proof.len() > 0, "Proof cannot be empty");

    milestone.attestation_proof = Some(proof.clone());
    milestone.status = MilestoneStatus::Attested;

    env.storage()
        .persistent()
        .set(&DataKey::Metadata(milestone_key),
             &milestone);

    env.events().publish(
        (symbol_short!("milestone"), symbol_short!("attested")),
        (milestone_id, proof),
    );

    common::_release_lock(env);
}

pub fn unlock_milestone(
    env: &Env,
    milestone_id: u64,
    client: Address,
) {
    common::_require_not_paused(env);
    client.require_auth();
    common::_acquire_lock(env);

    let milestone_key = String::from_str(env, &format!("milestone_{}", milestone_id));

    let mut milestone: Milestone = env
        .storage()
        .persistent()
        .get(&DataKey::Metadata(milestone_key.clone()))
        .expect("Milestone not found");

    let project: Project = env
        .storage()
        .persistent()
        .get(&DataKey::Project(milestone.project_id))
        .expect("Project not found");

    assert!(project.client == client, "Only project client can unlock");
    assert!(milestone.status == MilestoneStatus::Attested, "Milestone must be attested");
    assert!(milestone.attestation_proof.is_some(), "No attestation proof provided");

    milestone.status = MilestoneStatus::Unlocked;

    env.storage()
        .persistent()
        .set(&DataKey::Metadata(milestone_key),
             &milestone);

    env.events().publish(
        (symbol_short!("milestone"), symbol_short!("unlocked")),
        (milestone_id, milestone.amount),
    );

    common::_release_lock(env);
}

pub fn get_milestone(env: &Env, milestone_id: u64) -> Milestone {
    let milestone_key = String::from_str(env, &format!("milestone_{}", milestone_id));

    env.storage()
        .persistent()
        .get(&DataKey::Metadata(milestone_key))
        .expect("Milestone not found")
}
