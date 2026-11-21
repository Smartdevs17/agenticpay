use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SpendPolicy { pub agent: Address, pub per_transaction: i128, pub daily: i128, pub spent_today: i128, pub day: u64 }

pub fn can_spend(policy: &SpendPolicy, amount: i128) -> bool { amount > 0 && amount <= policy.per_transaction && policy.spent_today + amount <= policy.daily }
