#![no_std]
use soroban_sdk::{contract, contractimpl, contractmeta, symbol_short, Address, Env, IntoVal, Map, String, Symbol, TryFromVal, Val};

contractmeta!(
    key = "Description",
    val = "AgenticPay Revenue Sharing Pool"
);

const ADMIN: Symbol = symbol_short!("ADMIN");
const RECIPIENTS: Symbol = symbol_short!("RCPNTS");
const TOTAL_SHARES: Symbol = symbol_short!("TSHRES");
const MIN_DIST: Symbol = symbol_short!("MINDIST");
const ACCUMULATED_KEY: fn(Address) -> Symbol = |addr: Address| {
    Symbol::new(
        &addr
            .to_string()
            .as_bytes()
            .iter()
            .take(8)
            .copied()
            .collect::<heapless::Vec<u8, 8>>(),
    )
};

#[contract]
pub struct RevenuePool;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Recipient {
    pub wallet: Address,
    pub ratio_bps: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum DataKey {
    Admin,
    Recipients,
    TotalShares,
    MinDist,
    Accumulated(Address),
}

#[contractimpl]
impl RevenuePool {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Recipients, &Vec::new(&env));
        env.storage().instance().set(&DataKey::TotalShares, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::MinDist, &0i128);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    pub fn add_recipient(env: Env, wallet: Address, ratio_bps: u32) {
        Self::require_admin(&env);
        let total: u32 = env.storage().instance().get(&DataKey::TotalShares).unwrap();
        if total + ratio_bps > 10000 {
            panic!("total shares exceed 10000");
        }
        let mut recipients: Vec<Recipient> = env
            .storage()
            .instance()
            .get(&DataKey::Recipients)
            .unwrap();
        for r in recipients.iter() {
            if r.wallet == wallet {
                panic!("recipient already exists");
            }
        }
        recipients.push_back(Recipient { wallet: wallet.clone(), ratio_bps });
        env.storage().instance().set(&DataKey::Recipients, &recipients);
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total + ratio_bps));
        env.storage()
            .instance()
            .set(&DataKey::Accumulated(wallet), &0i128);
        env.events().publish(("revenue_pool", "recipient_added"), wallet);
    }

    pub fn remove_recipient(env: Env, wallet: Address) {
        Self::require_admin(&env);
        let mut recipients: Vec<Recipient> = env
            .storage()
            .instance()
            .get(&DataKey::Recipients)
            .unwrap();
        let mut removed_ratio = 0u32;
        let mut new_recipients: Vec<Recipient> = Vec::new(&env);
        for r in recipients.iter() {
            if r.wallet == wallet {
                removed_ratio = r.ratio_bps;
            } else {
                new_recipients.push_back(r);
            }
        }
        if removed_ratio == 0 {
            panic!("recipient not found");
        }
        let total: u32 = env.storage().instance().get(&DataKey::TotalShares).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total - removed_ratio));
        let accumulated: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Accumulated(wallet.clone()))
            .unwrap_or(0);
        if accumulated > 0 {
            env.storage()
                .instance()
                .set(&DataKey::Accumulated(wallet.clone()), &0i128);
            env.balance().decrease(accumulated);
        }
        env.storage().instance().set(&DataKey::Recipients, &new_recipients);
        env.events().publish(("revenue_pool", "recipient_removed"), wallet);
    }

    pub fn update_ratio(env: Env, wallet: Address, new_ratio_bps: u32) {
        Self::require_admin(&env);
        let mut recipients: Vec<Recipient> = env
            .storage()
            .instance()
            .get(&DataKey::Recipients)
            .unwrap();
        let total: u32 = env.storage().instance().get(&DataKey::TotalShares).unwrap();
        let mut found = false;
        let mut old_ratio = 0u32;
        let mut new_recipients: Vec<Recipient> = Vec::new(&env);
        for r in recipients.iter() {
            if r.wallet == wallet {
                old_ratio = r.ratio_bps;
                new_recipients.push_back(Recipient { wallet: wallet.clone(), ratio_bps: new_ratio_bps });
                found = true;
            } else {
                new_recipients.push_back(r);
            }
        }
        if !found {
            panic!("recipient not found");
        }
        if total - old_ratio + new_ratio_bps > 10000 {
            panic!("total shares exceed 10000");
        }
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total - old_ratio + new_ratio_bps));
        env.storage().instance().set(&DataKey::Recipients, &new_recipients);
        env.events().publish(("revenue_pool", "ratio_updated"), (wallet, new_ratio_bps));
    }

    pub fn distribute(env: Env) {
        let amount = env.current_contract().balance();
        if amount == 0 {
            return;
        }
        let recipients: Vec<Recipient> = env
            .storage()
            .instance()
            .get(&DataKey::Recipients)
            .unwrap();
        let total: u32 = env.storage().instance().get(&DataKey::TotalShares).unwrap();
        if total == 0 {
            return;
        }
        let min_dist: i128 = env.storage().instance().get(&DataKey::MinDist).unwrap_or(0);
        for r in recipients.iter() {
            let share = (amount * r.ratio_bps as i128) / total as i128;
            if share >= min_dist {
                let accumulated: i128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::Accumulated(r.wallet.clone()))
                    .unwrap_or(0);
                env.storage()
                    .instance()
                    .set(&DataKey::Accumulated(r.wallet.clone()), &(accumulated + share));
                env.events().publish(("revenue_pool", "distributed"), (r.wallet.clone(), share));
            }
        }
    }

    pub fn claim(env: Env) {
        let caller = env.current_contract();
        let accumulated: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Accumulated(caller.clone()))
            .unwrap_or(0);
        let min_dist: i128 = env.storage().instance().get(&DataKey::MinDist).unwrap_or(0);
        if accumulated < min_dist {
            panic!("below minimum distribution threshold");
        }
        env.storage()
            .instance()
            .set(&DataKey::Accumulated(caller.clone()), &0i128);
        env.balance().decrease(accumulated);
        env.events().publish(("revenue_pool", "claimed"), (caller.clone(), accumulated));
    }

    pub fn get_recipients(env: Env) -> Vec<Recipient> {
        env.storage()
            .instance()
            .get(&DataKey::Recipients)
            .unwrap()
    }

    pub fn get_accumulated(env: Env, wallet: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Accumulated(wallet))
            .unwrap_or(0)
    }

    pub fn set_min_distribution_threshold(env: Env, threshold: i128) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::MinDist, &threshold);
        env.events().publish(("revenue_pool", "min_dist_updated"), threshold);
    }

    pub fn transfer_ownership(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish(("revenue_pool", "ownership_transferred"), new_admin);
    }
}
