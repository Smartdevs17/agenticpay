use soroban_sdk::{contracttype, BytesN};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReceiptAnchor { pub batch_id: BytesN<32>, pub merkle_root: BytesN<32>, pub receipt_count: u32, pub committed_at: u64 }
