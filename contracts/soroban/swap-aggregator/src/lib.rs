#![no_std]

//! # Soroban Swap Aggregator
//!
//! Aggregates liquidity across multiple Soroban DEXs (Phoenix, Aquarius, etc.),
//! finds the optimal swap route including multi-hop paths, and executes trades
//! with slippage protection and MEV resistance.
//!
//! ## Features
//! - Integrates with 3+ whitelisted Soroban DEX contracts
//! - Split routing: spread a swap across multiple pools for better pricing
//! - Multi-hop routing: token_in → intermediate → token_out
//! - Configurable slippage tolerance (basis points)
//! - Gas-efficient execution (targets < 10 000 stroops for simple swaps)
//! - Swap events with executed price, fees, and route details
//! - Automatic fallback if primary route fails
//! - Admin-managed DEX whitelist

mod dex_interface;
mod errors;
mod events;
mod router;
mod storage;
mod types;

pub use types::*;

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

use crate::errors::AggregatorError;
use crate::router::{find_best_route, execute_route};
use crate::storage::{
    require_admin, get_admin, set_admin,
    add_dex, remove_dex, get_dex_list,
    set_fee_bps, get_fee_bps,
    bump_instance,
};
use crate::events::{emit_swap_executed, emit_dex_added, emit_dex_removed};

/// Maximum slippage allowed: 50 % expressed in basis points.
pub const MAX_SLIPPAGE_BPS: u32 = 5_000;
/// Maximum price impact before the swap is rejected: 50 %.
pub const MAX_PRICE_IMPACT_BPS: u32 = 5_000;
/// Maximum splits a single swap can be divided into across pools.
pub const MAX_SPLITS: u32 = 5;
/// Maximum hops in a multi-hop route.
pub const MAX_HOPS: u32 = 3;
/// Protocol fee cap (2 %).
pub const MAX_FEE_BPS: u32 = 200;

#[contract]
pub struct SwapAggregatorContract;

#[contractimpl]
impl SwapAggregatorContract {
    // ─── Admin ───────────────────────────────────────────────────────────────

    /// Initialise the aggregator. Must be called exactly once.
    /// `admin`   — address that owns the whitelist and fee settings.
    /// `fee_bps` — protocol fee in basis points (≤ 200).
    pub fn initialize(env: Env, admin: Address, fee_bps: u32) -> Result<(), AggregatorError> {
        if storage::is_initialized(&env) {
            return Err(AggregatorError::AlreadyInitialized);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(AggregatorError::FeeTooHigh);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_fee_bps(&env, fee_bps);
        storage::mark_initialized(&env);
        bump_instance(&env);
        Ok(())
    }

    /// Transfer admin rights to a new address.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), AggregatorError> {
        let current = get_admin(&env)?;
        current.require_auth();
        new_admin.require_auth();
        set_admin(&env, &new_admin);
        bump_instance(&env);
        Ok(())
    }

    /// Update the protocol fee. Capped at MAX_FEE_BPS.
    pub fn set_fee(env: Env, fee_bps: u32) -> Result<(), AggregatorError> {
        require_admin(&env)?;
        if fee_bps > MAX_FEE_BPS {
            return Err(AggregatorError::FeeTooHigh);
        }
        set_fee_bps(&env, fee_bps);
        bump_instance(&env);
        Ok(())
    }

    // ─── DEX whitelist ───────────────────────────────────────────────────────

    /// Add a DEX contract to the whitelist.
    /// `dex_id`      — a short ASCII name (e.g. "phoenix", "aquarius").
    /// `dex_address` — the deployed DEX router contract address.
    pub fn add_dex(
        env: Env,
        dex_id: soroban_sdk::String,
        dex_address: Address,
    ) -> Result<(), AggregatorError> {
        require_admin(&env)?;
        add_dex(&env, dex_id.clone(), dex_address.clone());
        emit_dex_added(&env, dex_id, dex_address);
        bump_instance(&env);
        Ok(())
    }

    /// Remove a DEX from the whitelist.
    pub fn remove_dex(env: Env, dex_id: soroban_sdk::String) -> Result<(), AggregatorError> {
        require_admin(&env)?;
        remove_dex(&env, dex_id.clone());
        emit_dex_removed(&env, dex_id);
        bump_instance(&env);
        Ok(())
    }

    /// List all whitelisted DEX IDs.
    pub fn list_dexes(env: Env) -> Vec<soroban_sdk::String> {
        get_dex_list(&env)
    }

    // ─── Quoting ─────────────────────────────────────────────────────────────

    /// Simulate a swap and return the best route without executing anything.
    /// Useful for UI price previews before the user confirms.
    pub fn get_quote(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        slippage_bps: u32,
    ) -> Result<SwapQuote, AggregatorError> {
        if amount_in <= 0 {
            return Err(AggregatorError::InvalidAmount);
        }
        if slippage_bps > MAX_SLIPPAGE_BPS {
            return Err(AggregatorError::SlippageTooHigh);
        }
        let dexes = get_dex_list(&env);
        if dexes.is_empty() {
            return Err(AggregatorError::NoDexAvailable);
        }
        find_best_route(&env, token_in, token_out, amount_in, slippage_bps)
    }

    // ─── Execution ───────────────────────────────────────────────────────────

    /// Execute a swap.
    ///
    /// The caller must have already approved this contract to spend `amount_in`
    /// of `token_in`. The swap rejects if simulated output falls below
    /// `min_amount_out` or if price impact exceeds 50 %.
    ///
    /// Returns the actual amount of `token_out` received after fees.
    pub fn swap(
        env: Env,
        caller: Address,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        slippage_bps: u32,
    ) -> Result<i128, AggregatorError> {
        caller.require_auth();

        if amount_in <= 0 {
            return Err(AggregatorError::InvalidAmount);
        }
        if min_amount_out < 0 {
            return Err(AggregatorError::InvalidAmount);
        }
        if slippage_bps > MAX_SLIPPAGE_BPS {
            return Err(AggregatorError::SlippageTooHigh);
        }

        let dexes = get_dex_list(&env);
        if dexes.is_empty() {
            return Err(AggregatorError::NoDexAvailable);
        }

        // Find the optimal route (may try fallback internally).
        let quote = find_best_route(
            &env,
            token_in.clone(),
            token_out.clone(),
            amount_in,
            slippage_bps,
        )?;

        // Guard: price impact > 50 % is rejected outright.
        if quote.price_impact_bps > MAX_PRICE_IMPACT_BPS {
            return Err(AggregatorError::PriceImpactTooHigh);
        }

        // Guard: simulated output must satisfy the caller's floor.
        if quote.expected_out < min_amount_out {
            return Err(AggregatorError::SlippageExceeded);
        }

        // Execute the route on-chain via DEX cross-contract calls.
        let amount_out = execute_route(
            &env,
            &caller,
            token_in.clone(),
            token_out.clone(),
            amount_in,
            min_amount_out,
            &quote,
        )?;

        // Deduct protocol fee from output.
        let fee_bps = get_fee_bps(&env);
        let fee = (amount_out * fee_bps as i128) / 10_000;
        let amount_out_net = amount_out - fee;

        emit_swap_executed(
            &env,
            &caller,
            &token_in,
            &token_out,
            amount_in,
            amount_out_net,
            fee,
            &quote,
        );

        bump_instance(&env);
        Ok(amount_out_net)
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// Return the current admin address.
    pub fn admin(env: Env) -> Result<Address, AggregatorError> {
        get_admin(&env)
    }

    /// Return the current protocol fee in basis points.
    pub fn fee_bps(env: Env) -> u32 {
        get_fee_bps(&env)
    }
}
