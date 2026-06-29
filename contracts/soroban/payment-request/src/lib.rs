#![no_std]

//! # Soroban Payment Request — Expiration Enforcement
//!
//! Time-bound payment requests enforced on-chain via Soroban ledger timestamps.
//!
//! Issue #460 — Payment Request Expiration with Smart Contract Enforcement

mod errors;
mod events;
mod storage;
mod types;

pub use types::*;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

use crate::errors::RequestError;
use crate::events::{emit_created, emit_paid, emit_expired, emit_cancelled, emit_renewed};
use crate::storage::{
    bump_instance, get_next_id, inc_next_id,
    get_request, set_request,
    get_grace_period, set_grace_period,
    get_admin, set_admin, require_admin, mark_initialized, is_initialized,
};

/// Minimum TTL: 60 seconds.
pub const MIN_TTL_SECS: u64 = 60;
/// Maximum TTL: 90 days.
pub const MAX_TTL_SECS: u64 = 90 * 24 * 3600;
/// Default grace period: 60 seconds (absorbs ledger close-time variance).
pub const DEFAULT_GRACE_PERIOD_SECS: u64 = 60;

#[contract]
pub struct PaymentRequestContract;

#[contractimpl]
impl PaymentRequestContract {
    // ─── Init ─────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), RequestError> {
        if is_initialized(&env) {
            return Err(RequestError::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_grace_period(&env, DEFAULT_GRACE_PERIOD_SECS);
        mark_initialized(&env);
        bump_instance(&env);
        Ok(())
    }

    pub fn set_grace_period(env: Env, grace_secs: u64) -> Result<(), RequestError> {
        require_admin(&env)?;
        set_grace_period(&env, grace_secs);
        bump_instance(&env);
        Ok(())
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    /// Create a time-bound payment request.
    ///
    /// - `requester`  — account creating the request (must auth)
    /// - `payer`      — optional specific payer; None = open to anyone
    /// - `token`      — SEP-41 token contract address
    /// - `amount`     — amount in token's smallest unit
    /// - `ttl_secs`   — time-to-live in seconds (60 – 7_776_000)
    /// - `memo`       — optional short description
    pub fn create_request(
        env: Env,
        requester: Address,
        payer: Option<Address>,
        token: Address,
        amount: i128,
        ttl_secs: u64,
        memo: String,
    ) -> Result<u64, RequestError> {
        requester.require_auth();
        if amount <= 0 {
            return Err(RequestError::InvalidAmount);
        }
        if ttl_secs < MIN_TTL_SECS || ttl_secs > MAX_TTL_SECS {
            return Err(RequestError::InvalidTtl);
        }

        let id = get_next_id(&env);
        inc_next_id(&env);

        let now = env.ledger().timestamp();
        let expires_at = now + ttl_secs;

        let req = PaymentRequest {
            id,
            requester: requester.clone(),
            payer: payer.clone(),
            token: token.clone(),
            amount,
            status: RequestStatus::Pending,
            created_at: now,
            expires_at,
            grace_period: get_grace_period(&env),
            expired_at: 0,
            paid_at: 0,
            memo: memo.clone(),
        };

        set_request(&env, id, &req);
        emit_created(&env, id, &requester, payer.as_ref(), &token, amount, expires_at, &memo);
        bump_instance(&env);
        Ok(id)
    }

    /// Pay a pending request. Enforces expiration via ledger timestamp.
    /// The payer must have pre-approved this contract to spend `amount` of `token`.
    pub fn pay(env: Env, payer: Address, id: u64) -> Result<(), RequestError> {
        payer.require_auth();

        let mut req = get_request(&env, id)?;

        // ── Expiration guard ──────────────────────────────────────────────────
        let now = env.ledger().timestamp();
        if now > req.expires_at + req.grace_period {
            req.status     = RequestStatus::Expired;
            req.expired_at = now;
            set_request(&env, id, &req);
            emit_expired(&env, id, &req.requester, now);
            return Err(RequestError::RequestIsExpired);
        }

        // ── Payer check ───────────────────────────────────────────────────────
        if let Some(ref expected) = req.payer {
            if *expected != payer {
                return Err(RequestError::UnauthorizedPayer);
            }
        }

        req.status  = RequestStatus::Paid;
        req.paid_at = now;
        set_request(&env, id, &req);

        // ── Token transfer ────────────────────────────────────────────────────
        // Cross-contract call to the SEP-41 token contract.
        let token_client = soroban_sdk::token::Client::new(&env, &req.token);
        token_client.transfer(&payer, &req.requester, &req.amount);

        emit_paid(&env, id, &req.requester, &payer, req.amount, now);
        bump_instance(&env);
        Ok(())
    }

    /// Mark a request as expired (callable by anyone after deadline + grace).
    pub fn expire_request(env: Env, id: u64) -> Result<(), RequestError> {
        let mut req = get_request(&env, id)?;
        let now = env.ledger().timestamp();

        if now <= req.expires_at + req.grace_period {
            return Err(RequestError::NotExpiredYet);
        }

        req.status     = RequestStatus::Expired;
        req.expired_at = now;
        set_request(&env, id, &req);
        emit_expired(&env, id, &req.requester, now);
        bump_instance(&env);
        Ok(())
    }

    /// Cancel a pending request (requester only).
    pub fn cancel_request(env: Env, requester: Address, id: u64) -> Result<(), RequestError> {
        requester.require_auth();
        let mut req = get_request(&env, id)?;

        if req.requester != requester {
            return Err(RequestError::Unauthorized);
        }

        req.status = RequestStatus::Cancelled;
        set_request(&env, id, &req);
        emit_cancelled(&env, id, &requester);
        bump_instance(&env);
        Ok(())
    }

    /// Renew an expired or cancelled request with a new amount and TTL.
    /// Returns the new request ID.
    pub fn renew_request(
        env: Env,
        requester: Address,
        old_id: u64,
        new_amount: i128,
        new_ttl_secs: u64,
    ) -> Result<u64, RequestError> {
        requester.require_auth();

        let old_req = get_request(&env, old_id)?;
        if old_req.requester != requester {
            return Err(RequestError::Unauthorized);
        }
        match old_req.status {
            RequestStatus::Expired | RequestStatus::Cancelled => {}
            _ => return Err(RequestError::CannotRenewActive),
        }
        if new_amount <= 0 {
            return Err(RequestError::InvalidAmount);
        }
        if new_ttl_secs < MIN_TTL_SECS || new_ttl_secs > MAX_TTL_SECS {
            return Err(RequestError::InvalidTtl);
        }

        let new_id = get_next_id(&env);
        inc_next_id(&env);
        let now = env.ledger().timestamp();
        let new_expires_at = now + new_ttl_secs;

        let new_req = PaymentRequest {
            id:           new_id,
            requester:    old_req.requester.clone(),
            payer:        old_req.payer.clone(),
            token:        old_req.token.clone(),
            amount:       new_amount,
            status:       RequestStatus::Pending,
            created_at:   now,
            expires_at:   new_expires_at,
            grace_period: get_grace_period(&env),
            expired_at:   0,
            paid_at:      0,
            memo:         old_req.memo.clone(),
        };

        set_request(&env, new_id, &new_req);
        emit_renewed(&env, old_id, new_id, new_amount, new_expires_at);
        bump_instance(&env);
        Ok(new_id)
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    pub fn get_request(env: Env, id: u64) -> Result<PaymentRequest, RequestError> {
        get_request(&env, id)
    }

    pub fn is_expired(env: Env, id: u64) -> bool {
        match get_request(&env, id) {
            Err(_) => false,
            Ok(req) => {
                req.status == RequestStatus::Expired
                    || env.ledger().timestamp() > req.expires_at + req.grace_period
            }
        }
    }

    pub fn admin(env: Env) -> Result<Address, RequestError> {
        get_admin(&env)
    }

    pub fn grace_period(env: Env) -> u64 {
        get_grace_period(&env)
    }
}
