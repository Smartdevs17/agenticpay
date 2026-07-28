use soroban_sdk::{Address, Env};
use crate::common::{self, *};

pub fn raise_dispute(env: &Env, project_id: u64, caller: Address) {
    common::_require_not_paused(env);
    caller.require_auth();
    common::_acquire_lock(env);

    let mut project: Project = env
        .storage()
        .persistent()
        .get(&DataKey::Project(project_id))
        .expect("Project not found");

    assert!(
        caller == project.client || caller == project.freelancer,
        "Only client or freelancer can dispute"
    );

    project.status = ProjectStatus::Disputed;

    env.storage()
        .persistent()
        .set(&DataKey::Project(project_id), &project);

    env.events().publish(
        (symbol_short!("project"), symbol_short!("disputed")),
        (project_id, caller),
    );

    common::_release_lock(env);
}

pub fn resolve_dispute(env: &Env, project_id: u64, admin: Address, release_to_freelancer: bool) {
    common::_require_not_paused(env);
    admin.require_auth();
    common::_acquire_lock(env);

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
        .expect("Project not found");

    assert!(
        project.status == ProjectStatus::Disputed,
        "Project must be disputed"
    );

    let _refund_amount = project.deposited;
    project.deposited = 0;

    if release_to_freelancer {
        project.status = ProjectStatus::Completed;
    } else {
        project.status = ProjectStatus::Cancelled;
    }

    env.storage()
        .persistent()
        .set(&DataKey::Project(project_id), &project);

    common::_release_lock(env);
}
