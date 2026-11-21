//! Deterministic per-second streaming payment accounting.
use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentStream {
    pub sender: Address,
    pub recipient: Address,
    pub rate_per_second: i128,
    pub start_at: u64,
    pub end_at: u64,
    pub total: i128,
    pub withdrawn: i128,
}

pub fn accrued(stream: &PaymentStream, timestamp: u64) -> i128 {
    let elapsed = timestamp.min(stream.end_at).saturating_sub(stream.start_at) as i128;
    (elapsed * stream.rate_per_second).min(stream.total)
}

pub fn withdrawable(stream: &PaymentStream, timestamp: u64) -> i128 {
    accrued(stream, timestamp).saturating_sub(stream.withdrawn)
}
