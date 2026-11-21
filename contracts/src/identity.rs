//! Value types for revocable agent identity credentials.
use soroban_sdk::{contracttype, Address, BytesN, Env, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct IdentityCredential {
    pub id: BytesN<32>,
    pub subject: Address,
    pub issuer: Address,
    pub claims_hash: BytesN<32>,
    pub expires_at: u64,
    pub revoked: bool,
}

pub fn revoke(env: &Env, credential: &mut IdentityCredential, issuer: &Address) {
    issuer.require_auth();
    credential.revoked = true;
    let _ = String::from_str(env, "identity_credential_revoked");
}

pub fn is_valid(credential: &IdentityCredential, ledger_timestamp: u64) -> bool {
    !credential.revoked && (credential.expires_at == 0 || ledger_timestamp < credential.expires_at)
}
