#![no_std]

//! Upgradeable Proxy Pattern for Soroban Contracts
//! 
//! This module implements a transparent proxy pattern that allows contract
//! upgrades while preserving storage and contract address. The proxy delegates
//! all calls to an implementation contract and can be upgraded by the admin.

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Symbol, Vec};

#[contracttype]
pub enum DataKey {
    /// Address of the current implementation contract
    Implementation,
    /// Admin address authorized to upgrade
    Admin,
    /// Initialization flag to prevent re-initialization
    Initialized,
}

#[contract]
pub struct UpgradeableProxy;

#[contractimpl]
impl UpgradeableProxy {
    /// Initialize the proxy with an implementation and admin
    /// Can only be called once
    pub fn initialize(env: Env, implementation: Address, admin: Address) {
        // Ensure not already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("Already initialized");
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Implementation, &implementation);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);

        env.events().publish(
            (Symbol::new(&env, "proxy"), Symbol::new(&env, "init")),
            (implementation, admin),
        );
    }

    /// Upgrade to a new implementation contract
    /// Only callable by admin
    pub fn upgrade_to(env: Env, new_implementation: Address, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");

        if admin != stored_admin {
            panic!("Only admin can upgrade");
        }

        let old_implementation: Address = env
            .storage()
            .instance()
            .get(&DataKey::Implementation)
            .expect("No implementation set");

        env.storage()
            .instance()
            .set(&DataKey::Implementation, &new_implementation);

        env.events().publish(
            (Symbol::new(&env, "proxy"), Symbol::new(&env, "upgraded")),
            (old_implementation, new_implementation),
        );
    }

    /// Transfer admin rights to a new address
    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");

        if current_admin != stored_admin {
            panic!("Only current admin can transfer");
        }

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (Symbol::new(&env, "proxy"), Symbol::new(&env, "admin_changed")),
            (current_admin, new_admin),
        );
    }

    /// Get the current implementation address
    pub fn get_implementation(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Implementation)
            .expect("Not initialized")
    }

    /// Get the current admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_proxy_initialization() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, UpgradeableProxy);
        let client = UpgradeableProxyClient::new(&env, &contract_id);

        let implementation = Address::generate(&env);
        let admin = Address::generate(&env);

        client.initialize(&implementation, &admin);

        assert_eq!(client.get_implementation(), implementation);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_cannot_reinitialize() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, UpgradeableProxy);
        let client = UpgradeableProxyClient::new(&env, &contract_id);

        let implementation = Address::generate(&env);
        let admin = Address::generate(&env);

        client.initialize(&implementation, &admin);
        client.initialize(&implementation, &admin); // Should panic
    }

    #[test]
    fn test_upgrade() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, UpgradeableProxy);
        let client = UpgradeableProxyClient::new(&env, &contract_id);

        let implementation_v1 = Address::generate(&env);
        let implementation_v2 = Address::generate(&env);
        let admin = Address::generate(&env);

        client.initialize(&implementation_v1, &admin);
        assert_eq!(client.get_implementation(), implementation_v1);

        client.upgrade_to(&implementation_v2, &admin);
        assert_eq!(client.get_implementation(), implementation_v2);
    }

    #[test]
    #[should_panic(expected = "Only admin can upgrade")]
    fn test_upgrade_requires_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, UpgradeableProxy);
        let client = UpgradeableProxyClient::new(&env, &contract_id);

        let implementation = Address::generate(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.initialize(&implementation, &admin);
        client.upgrade_to(&Address::generate(&env), &attacker); // Should panic
    }

    #[test]
    fn test_transfer_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, UpgradeableProxy);
        let client = UpgradeableProxyClient::new(&env, &contract_id);

        let implementation = Address::generate(&env);
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);

        client.initialize(&implementation, &admin1);
        assert_eq!(client.get_admin(), admin1);

        client.transfer_admin(&admin1, &admin2);
        assert_eq!(client.get_admin(), admin2);
    }
}
