use crate::{AgenticPayContract, AgenticPayContractClient, DataKey, ProjectStatus, SecurityStatus};
use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

fn setup_contract(env: &Env) -> (Address, Address, Address, AgenticPayContractClient<'_>) {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AgenticPayContract);
    let contract = AgenticPayContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let client = Address::generate(env);
    let freelancer = Address::generate(env);
    contract.initialize(&admin);
    (admin, client, freelancer, contract)
}

fn create_funded_project(
    env: &Env,
    contract: &AgenticPayContractClient<'_>,
    client: &Address,
    freelancer: &Address,
    amount: i128,
) -> u64 {
    let project_id = contract.create_project(
        client,
        freelancer,
        &amount,
        &String::from_str(env, "Security test"),
        &String::from_str(env, "https://github.com/security/test"),
        &(env.ledger().timestamp() + 1000),
    );
    contract.fund_project(&project_id, client, &amount);
    project_id
}

#[test]
fn emergency_pause_blocks_guarded_mutations() {
    let env = Env::default();
    let (admin, client, freelancer, contract) = setup_contract(&env);

    contract.set_emergency_pause(&admin, &true);
    let status: SecurityStatus = contract.get_security_status();
    assert!(status.paused);
    assert!(!status.locked);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.create_project(
            &client,
            &freelancer,
            &10,
            &String::from_str(&env, "Paused mutation"),
            &String::from_str(&env, "https://github.com/security/paused"),
            &(env.ledger().timestamp() + 1000),
        );
    }));

    assert!(result.is_err());
    assert_eq!(contract.get_project_count(), 0);
    let status = contract.get_security_status();
    assert!(status.paused);
    assert!(!status.locked);
    assert_eq!(status.reentrancy_incidents, 0);
}

#[test]
fn emergency_pause_can_be_released_by_admin() {
    let env = Env::default();
    let (admin, client, freelancer, contract) = setup_contract(&env);

    contract.set_emergency_pause(&admin, &true);
    contract.set_emergency_pause(&admin, &false);

    let project_id = contract.create_project(
        &client,
        &freelancer,
        &10,
        &String::from_str(&env, "Unpaused mutation"),
        &String::from_str(&env, "https://github.com/security/unpaused"),
        &(env.ledger().timestamp() + 1000),
    );

    assert_eq!(project_id, 1);
    assert!(!contract.get_security_status().paused);
}

#[test]
fn reentrancy_lock_blocks_guarded_mutation() {
    let env = Env::default();
    let (_admin, client, freelancer, contract) = setup_contract(&env);
    let contract_id = contract.address.clone();

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::ReentrancyLock, &true);
    });

    let project_id = contract.create_project(
        &client,
        &freelancer,
        &10,
        &String::from_str(&env, "Nested mutation"),
        &String::from_str(&env, "https://github.com/security/reentrant"),
        &(env.ledger().timestamp() + 1000),
    );

    assert_eq!(project_id, 0);
    assert_eq!(contract.get_project_count(), 0);
    let status = contract.get_security_status();
    assert!(status.paused);
    assert!(status.locked);
    assert_eq!(status.reentrancy_incidents, 1);
}

#[test]
fn successful_mutation_releases_reentrancy_lock() {
    let env = Env::default();
    let (_admin, client, freelancer, contract) = setup_contract(&env);

    let project_id = create_funded_project(&env, &contract, &client, &freelancer, 25);

    let status = contract.get_security_status();
    assert!(!status.locked);
    assert_eq!(status.reentrancy_incidents, 0);

    let project = contract.get_project(&project_id);
    assert_eq!(project.status, ProjectStatus::Funded);
    assert_eq!(project.deposited, 25);
}

proptest! {
    #[test]
    fn funded_projects_preserve_escrow_accounting(amount in 1i128..1_000_000i128) {
        let env = Env::default();
        let (_admin, client, freelancer, contract) = setup_contract(&env);

        let project_id = create_funded_project(&env, &contract, &client, &freelancer, amount);
        let project = contract.get_project(&project_id);

        prop_assert_eq!(project.amount, amount);
        prop_assert_eq!(project.deposited, amount);
        prop_assert_eq!(project.status, ProjectStatus::Funded);
        prop_assert!(!contract.get_security_status().locked);
    }
}
