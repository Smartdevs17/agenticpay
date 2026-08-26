//! Soroban cross-contract interface for calling whitelisted DEX routers.
//!
//! Phoenix DEX and Aquarius both expose a `swap` entry point with the
//! signature below.  For DEXs with different ABIs the trait would need
//! a per-DEX adapter, but this generic interface matches the common
//! Soroban DEX pattern used in the Stellar ecosystem.

use soroban_sdk::{contractclient, Address, Env};

/// Generic swap interface that compliant Soroban DEXs must expose.
/// Called via cross-contract invocation from the aggregator.
#[contractclient(name = "DexRouterClient")]
pub trait DexRouter {
    /// Execute a swap on the DEX.
    ///
    /// - `caller`         — Address paying `amount_in` of `token_in`
    /// - `token_in`       — Asset being sold
    /// - `token_out`      — Asset being bought
    /// - `amount_in`      — Exact input amount
    /// - `min_amount_out` — Slippage floor; DEX must revert if not met
    ///
    /// Returns the actual amount of `token_out` transferred to `caller`.
    fn swap(
        env: Env,
        caller: Address,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> i128;

    /// Quote only — no state changes. Returns expected output for `amount_in`.
    fn get_swap_quote(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
    ) -> i128;
}
