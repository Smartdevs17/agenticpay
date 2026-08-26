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
