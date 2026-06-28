#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec};

/// Storage keys for the pause security module.
#[contracttype]
pub enum PauseDataKey {
    /// Contract admin address.
    Admin,
    /// Whether the contract is currently paused.
    Paused,
    /// Unix timestamp when the contract was paused.
    PausedAt,
    /// Auto-unpause timeout in seconds (0 = no auto-unpause).
    UnpauseTimeout,
    /// Guardian address that can trigger emergency pause.
    Guardian,
    /// List of multi-sig signer addresses for unpause.
    UnpauseSigners,
    /// Number of approvals required to unpause.
    UnpauseThreshold,
    /// Current unpause approval count.
    UnpauseApprovalCount,
    /// Tracks whether a signer has approved unpause.
    SignerApproved(Address),
    /// Reentrancy latch.
    ReentrancyLock,
}

/// Emitted when the contract is paused or unpaused.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseEvent {
    pub paused: bool,
    pub actor: Address,
    pub timestamp: u64,
}

/// Maximum auto-unpause timeout: 72 hours (259200 seconds).
const MAX_UNPAUSE_TIMEOUT: u64 = 259_200;

#[contract]
pub struct PauseSecurityContract;

#[contractimpl]
impl PauseSecurityContract {
    // ── Reentrancy guard ─────────────────────────────────────────────────

    fn _acquire_lock(env: &Env) {
        let locked: bool = env
            .storage()
            .instance()
            .get(&PauseDataKey::ReentrancyLock)
            .unwrap_or(false);
        assert!(!locked, "reentrant call");
        env.storage()
            .instance()
            .set(&PauseDataKey::ReentrancyLock, &true);
    }

    fn _release_lock(env: &Env) {
        env.storage()
            .instance()
            .set(&PauseDataKey::ReentrancyLock, &false);
    }

    // ── Initialization ───────────────────────────────────────────────────

    /// Initialize the pause security module.
    ///
    /// # Arguments
    /// * `admin` - Admin address (can manage guardian and signers)
    /// * `guardian` - Guardian address (can trigger emergency pause)
    /// * `unpause_signers` - Addresses for multi-sig unpause
    /// * `threshold` - Number of signer approvals needed to unpause
    /// * `timeout` - Auto-unpause timeout in seconds (max 72 hours, 0 = disabled)
    pub fn initialize(
        env: Env,
        admin: Address,
        guardian: Address,
        unpause_signers: Vec<Address>,
        threshold: u32,
        timeout: u64,
    ) {
        admin.require_auth();
        assert!(timeout <= MAX_UNPAUSE_TIMEOUT, "timeout exceeds 72 hours");
        assert!(
            threshold as u32 <= unpause_signers.len(),
            "threshold exceeds signer count"
        );

        env.storage().instance().set(&PauseDataKey::Admin, &admin);
        env.storage().instance().set(&PauseDataKey::Guardian, &guardian);
        env.storage().instance().set(&PauseDataKey::Paused, &false);
        env.storage().instance().set(&PauseDataKey::PausedAt, &0u64);
        env.storage()
            .instance()
            .set(&PauseDataKey::UnpauseTimeout, &timeout);
        env.storage()
            .instance()
            .set(&PauseDataKey::UnpauseSigners, &unpause_signers);
        env.storage()
            .instance()
            .set(&PauseDataKey::UnpauseThreshold, &threshold);
        env.storage()
            .instance()
            .set(&PauseDataKey::UnpauseApprovalCount, &0u32);
        env.storage()
            .instance()
            .set(&PauseDataKey::ReentrancyLock, &false);
    }

    // ── Views ────────────────────────────────────────────────────────────

    /// Returns true if the contract is currently paused (respecting timeout).
    pub fn is_paused(env: Env) -> bool {
        let paused: bool = env
            .storage()
            .instance()
            .get(&PauseDataKey::Paused)
            .unwrap_or(false);
        if !paused {
            return false;
        }

        let timeout: u64 = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseTimeout)
            .unwrap_or(0);
        if timeout == 0 {
            return true;
        }

        let paused_at: u64 = env
            .storage()
            .instance()
            .get(&PauseDataKey::PausedAt)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        now < paused_at + timeout
    }

    pub fn get_pause_state(env: Env) -> (bool, u64, u64, u32, u32) {
        let paused = Self::is_paused(env.clone());
        let paused_at: u64 = env
            .storage()
            .instance()
            .get(&PauseDataKey::PausedAt)
            .unwrap_or(0);
        let timeout: u64 = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseTimeout)
            .unwrap_or(0);
        let approval_count: u32 = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseApprovalCount)
            .unwrap_or(0);
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseThreshold)
            .unwrap_or(0);
        (paused, paused_at, timeout, approval_count, threshold)
    }

    // ── Emergency Pause (guardian only) ──────────────────────────────────

    /// Guardian triggers emergency pause.
    pub fn emergency_pause(env: Env, guardian: Address) {
        guardian.require_auth();
        Self::_acquire_lock(&env);

        let stored_guardian: Address = env
            .storage()
            .instance()
            .get(&PauseDataKey::Guardian)
            .expect("Not initialized");
        assert!(guardian == stored_guardian, "Only guardian can pause");

        let now = env.ledger().timestamp();

        env.storage().instance().set(&PauseDataKey::Paused, &true);
        env.storage().instance().set(&PauseDataKey::PausedAt, &now);
        env.storage()
            .instance()
            .set(&PauseDataKey::UnpauseApprovalCount, &0u32);

        // Reset all signer approvals
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseSigners)
            .unwrap_or(Vec::new(&env));
        for i in 0..signers.len() {
            let signer = signers.get(i).unwrap();
            env.storage()
                .instance()
                .set(&PauseDataKey::SignerApproved(signer), &false);
        }

        env.events().publish(
            (symbol_short!("pause"), symbol_short!("active")),
            (guardian, now),
        );

        Self::_release_lock(&env);
    }

    // ── Multi-sig Unpause ────────────────────────────────────────────────

    /// A signer approves unpause. When threshold is met, contract unpauses.
    pub fn approve_unpause(env: Env, signer: Address) {
        signer.require_auth();
        Self::_acquire_lock(&env);

        assert!(Self::is_paused(env.clone()), "Contract is not paused");

        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseSigners)
            .unwrap_or(Vec::new(&env));

        let mut is_signer = false;
        for i in 0..signers.len() {
            if signers.get(i).unwrap() == signer {
                is_signer = true;
                break;
            }
        }
        assert!(is_signer, "Not an unpause signer");

        let already_approved: bool = env
            .storage()
            .instance()
            .get(&PauseDataKey::SignerApproved(signer.clone()))
            .unwrap_or(false);
        assert!(!already_approved, "Already approved unpause");

        env.storage()
            .instance()
            .set(&PauseDataKey::SignerApproved(signer.clone()), &true);

        let mut count: u32 = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseApprovalCount)
            .unwrap_or(0);
        count += 1;
        env.storage()
            .instance()
            .set(&PauseDataKey::UnpauseApprovalCount, &count);

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseThreshold)
            .unwrap_or(0);

        env.events().publish(
            (symbol_short!("pause"), symbol_short!("approve")),
            (signer.clone(), count, threshold),
        );

        if count >= threshold {
            env.storage().instance().set(&PauseDataKey::Paused, &false);
            env.events().publish(
                (symbol_short!("pause"), symbol_short!("resume")),
                (signer, env.ledger().timestamp()),
            );
        }

        Self::_release_lock(&env);
    }

    /// Finalize auto-unpause after timeout has expired.
    pub fn finalize_auto_unpause(env: Env) {
        Self::_acquire_lock(&env);

        let paused: bool = env
            .storage()
            .instance()
            .get(&PauseDataKey::Paused)
            .unwrap_or(false);
        assert!(paused, "Contract is not paused");

        let timeout: u64 = env
            .storage()
            .instance()
            .get(&PauseDataKey::UnpauseTimeout)
            .unwrap_or(0);
        assert!(timeout > 0, "No auto-unpause timeout configured");

        let paused_at: u64 = env
            .storage()
            .instance()
            .get(&PauseDataKey::PausedAt)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        assert!(now >= paused_at + timeout, "Timeout has not expired");

        env.storage().instance().set(&PauseDataKey::Paused, &false);
        env.events().publish(
            (symbol_short!("pause"), symbol_short!("timeout")),
            now,
        );

        Self::_release_lock(&env);
    }

    // ── Admin Configuration ──────────────────────────────────────────────

    /// Change the guardian address. Admin-only.
    pub fn set_guardian(env: Env, admin: Address, new_guardian: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&PauseDataKey::Admin)
            .expect("Not initialized");
        assert!(admin == stored_admin, "Only admin");

        env.storage()
            .instance()
            .set(&PauseDataKey::Guardian, &new_guardian);

        env.events().publish(
            (symbol_short!("pause"), symbol_short!("guard")),
            new_guardian,
        );
    }

    /// Update auto-unpause timeout. Admin-only.
    pub fn set_unpause_timeout(env: Env, admin: Address, timeout: u64) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&PauseDataKey::Admin)
            .expect("Not initialized");
        assert!(admin == stored_admin, "Only admin");
        assert!(timeout <= MAX_UNPAUSE_TIMEOUT, "timeout exceeds 72 hours");

        env.storage()
            .instance()
            .set(&PauseDataKey::UnpauseTimeout, &timeout);
    }
}
