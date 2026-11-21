use soroban_sdk::{contracttype, Address, String};

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum RequestStatus {
    Pending,
    Paid,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct PaymentRequest {
    pub id:           u64,
    pub requester:    Address,
    /// None = open to any payer.
    pub payer:        Option<Address>,
    /// SEP-41 token contract address.
    pub token:        Address,
    pub amount:       i128,
    pub status:       RequestStatus,
    pub created_at:   u64,
    /// Unix timestamp after which the request is expired.
    pub expires_at:   u64,
    /// Extra seconds of grace beyond expires_at.
    pub grace_period: u64,
    /// 0 until the request expires.
    pub expired_at:   u64,
    /// 0 until the request is paid.
    pub paid_at:      u64,
    pub memo:         String,
}
