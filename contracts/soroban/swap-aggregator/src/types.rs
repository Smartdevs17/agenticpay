#![allow(dead_code)]

use soroban_sdk::{contracttype, Address, String, Vec};

/// A single leg of a multi-hop route.
#[contracttype]
#[derive(Clone)]
pub struct RouteLeg {
    /// DEX contract that will execute this leg.
    pub dex_id: String,
    /// DEX router contract address.
    pub dex_address: Address,
    /// Token being sold in this leg.
    pub token_in: Address,
    /// Token being received in this leg.
    pub token_out: Address,
    /// Fraction of the total input amount routed through this leg,
    /// expressed in basis points (sum across all legs ≤ 10 000).
    pub split_bps: u32,
    /// Simulated output amount for this leg.
    pub expected_out: i128,
}

/// Full swap route returned by the quoting engine.
#[contracttype]
#[derive(Clone)]
pub struct SwapRoute {
    /// Ordered list of legs (1 = direct, 2-3 = multi-hop).
    pub legs: Vec<RouteLeg>,
    /// Total simulated output across all legs.
    pub expected_out: i128,
    /// Total fee charged by all DEXs in this route (in token_out units).
    pub dex_fees: i128,
    /// Whether this route uses an intermediate token (multi-hop).
    pub is_multi_hop: bool,
}

/// Quote returned to callers before execution.
#[contracttype]
#[derive(Clone)]
pub struct SwapQuote {
    /// Best route found.
    pub route: SwapRoute,
    /// Total expected output.
    pub expected_out: i128,
    /// Minimum acceptable output after applying slippage tolerance.
    pub min_amount_out: i128,
    /// Slippage tolerance used (basis points).
    pub slippage_bps: u32,
    /// Estimated price impact (basis points).
    pub price_impact_bps: u32,
    /// Whether split routing was used.
    pub is_split: bool,
    /// Ledger sequence at which this quote was generated.
    pub quoted_at_ledger: u32,
}

/// DEX registry entry.
#[contracttype]
#[derive(Clone)]
pub struct DexEntry {
    pub dex_id: String,
    pub dex_address: Address,
    pub active: bool,
}
