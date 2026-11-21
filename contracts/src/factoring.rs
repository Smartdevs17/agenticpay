use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FactoredInvoice { pub id: u64, pub debtor: Address, pub face_value: i128, pub due_at: u64, pub funded: bool }

pub fn discounted_proceeds(face_value: i128, discount_bps: u32) -> i128 { assert!(discount_bps < 10_000); face_value * (10_000 - discount_bps as i128) / 10_000 }
