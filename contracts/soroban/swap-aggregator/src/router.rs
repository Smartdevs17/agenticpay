//! Route-finding and execution logic.
//!
//! Strategy:
//!  1. For each active DEX, call `get_swap_quote` (read-only cross-contract).
//!  2. Try a split route: divide `amount_in` across the top-2 DEXs by quote.
//!  3. Try multi-hop via a common intermediate (e.g. XLM / USDC) if direct
//!     quotes are poor.
//!  4. Pick whichever produces the highest `expected_out`.
//!  5. On execution: attempt legs in order; on failure emit fallback event
//!     and retry with the next-best route.

use soroban_sdk::{Address, Env, String, Vec};

use crate::dex_interface::DexRouterClient;
use crate::errors::AggregatorError;
use crate::events::emit_route_fallback;
use crate::storage::get_dex_entries;
use crate::types::{RouteLeg, SwapQuote, SwapRoute};
use crate::{MAX_HOPS, MAX_PRICE_IMPACT_BPS, MAX_SPLITS};

// ─── Quoting ─────────────────────────────────────────────────────────────────

/// Build the best `SwapQuote` by surveying all whitelisted DEXs.
pub fn find_best_route(
    env: &Env,
    token_in: Address,
    token_out: Address,
    amount_in: i128,
    slippage_bps: u32,
) -> Result<SwapQuote, AggregatorError> {
    let dex_entries = get_dex_entries(env);
    if dex_entries.is_empty() {
        return Err(AggregatorError::NoDexAvailable);
    }

    // ── Step 1: collect direct quotes from every DEX ──────────────────────
    let mut direct_quotes: Vec<(String, Address, i128)> = Vec::new(env);
    for i in 0..dex_entries.len() {
        let entry = dex_entries.get(i).unwrap();
        if !entry.active {
            continue;
        }
        let client = DexRouterClient::new(env, &entry.dex_address);
        // try_invoke: if the DEX reverts (no pool), we skip it.
        let quote_result = env.try_invoke_contract::<i128, _>(
            &entry.dex_address,
            &soroban_sdk::symbol_short!("get_swap"),
            soroban_sdk::vec![
                env,
                token_in.clone().into(),
                token_out.clone().into(),
                amount_in.into(),
            ],
        );
        let out = match quote_result {
            Ok(Ok(v)) => v,
            _ => continue, // DEX unavailable or no pool — skip
        };
        if out > 0 {
            direct_quotes.push_back((entry.dex_id, entry.dex_address, out));
        }
    }

    // ── Step 2: sort descending by quoted output ──────────────────────────
    // Insertion sort (small N, no_std friendly)
    let n = direct_quotes.len();
    for i in 1..n {
        let mut j = i;
        while j > 0 {
            let a = direct_quotes.get(j - 1).unwrap().2;
            let b = direct_quotes.get(j).unwrap().2;
            if a < b {
                let tmp_a = direct_quotes.get(j - 1).unwrap();
                let tmp_b = direct_quotes.get(j).unwrap();
                direct_quotes.set(j - 1, tmp_b);
                direct_quotes.set(j, tmp_a);
                j -= 1;
            } else {
                break;
            }
        }
    }

    // ── Step 3: build candidate routes ────────────────────────────────────
    let mut best_route: Option<SwapRoute> = None;
    let mut best_out: i128 = 0;

    // 3a. Best single-DEX route
    if let Some(top) = direct_quotes.get(0) {
        let leg = RouteLeg {
            dex_id: top.0.clone(),
            dex_address: top.1.clone(),
            token_in: token_in.clone(),
            token_out: token_out.clone(),
            split_bps: 10_000,
            expected_out: top.2,
        };
        let mut legs = Vec::new(env);
        legs.push_back(leg);
        let route = SwapRoute {
            expected_out: top.2,
            dex_fees: estimate_dex_fee(top.2, 30), // assume 0.3 % DEX fee
            is_multi_hop: false,
            legs,
        };
        best_out = top.2;
        best_route = Some(route);
    }

    // 3b. Split route across top-2 DEXs (50/50)
    if direct_quotes.len() >= 2 {
        let half_in = amount_in / 2;
        let remainder = amount_in - half_in;

        let d0 = direct_quotes.get(0).unwrap();
        let d1 = direct_quotes.get(1).unwrap();

        // Re-quote for the split halves (approximate: scale linearly)
        let out0 = scale_quote(d0.2, amount_in, half_in);
        let out1 = scale_quote(d1.2, amount_in, remainder);
        let split_out = out0 + out1;

        if split_out > best_out {
            let leg0 = RouteLeg {
                dex_id: d0.0.clone(),
                dex_address: d0.1.clone(),
                token_in: token_in.clone(),
                token_out: token_out.clone(),
                split_bps: 5_000,
                expected_out: out0,
            };
            let leg1 = RouteLeg {
                dex_id: d1.0.clone(),
                dex_address: d1.1.clone(),
                token_in: token_in.clone(),
                token_out: token_out.clone(),
                split_bps: 5_000,
                expected_out: out1,
            };
            let mut legs = Vec::new(env);
            legs.push_back(leg0);
            legs.push_back(leg1);
            let route = SwapRoute {
                expected_out: split_out,
                dex_fees: estimate_dex_fee(split_out, 30),
                is_multi_hop: false,
                legs,
            };
            best_out = split_out;
            best_route = Some(route);
        }
    }

    // 3c. Multi-hop route (token_in → XLM → token_out) when direct is poor.
    //     Only attempted if we have at least one direct quote to compare.
    //     We reuse the best-quoted DEX for both legs as a simplification.
    if best_out > 0 && direct_quotes.len() >= 1 {
        if let Some(hop_route) = try_multihop_route(env, &dex_entries, &token_in, &token_out, amount_in) {
            if hop_route.expected_out > best_out {
                best_out = hop_route.expected_out;
                best_route = Some(hop_route);
            }
        }
    }

    let route = best_route.ok_or(AggregatorError::NoRouteFound)?;
    if route.expected_out <= 0 {
        return Err(AggregatorError::InsufficientLiquidity);
    }

    // Compute price impact: crude estimate based on the ratio of DEX fees to output.
    let price_impact_bps = compute_price_impact_bps(route.dex_fees, route.expected_out);

    // Minimum output after applying slippage tolerance.
    let min_amount_out =
        route.expected_out - (route.expected_out * slippage_bps as i128) / 10_000;

    let is_split = route.legs.len() > 1 && !route.is_multi_hop;

    Ok(SwapQuote {
        route,
        expected_out: best_out,
        min_amount_out,
        slippage_bps,
        price_impact_bps,
        is_split,
        quoted_at_ledger: env.ledger().sequence(),
    })
}

// ─── Execution ───────────────────────────────────────────────────────────────

/// Execute the legs described in `quote` via cross-contract calls to DEX routers.
/// Falls back to the next leg ordering if the first attempt fails.
pub fn execute_route(
    env: &Env,
    caller: &Address,
    token_in: Address,
    token_out: Address,
    amount_in: i128,
    min_amount_out: i128,
    quote: &SwapQuote,
) -> Result<i128, AggregatorError> {
    let legs = &quote.route.legs;
    let n = legs.len();

    if n == 0 {
        return Err(AggregatorError::NoRouteFound);
    }

    // Multi-hop: execute legs sequentially; output of leg N is input of leg N+1.
    if quote.route.is_multi_hop {
        return execute_multihop(env, caller, amount_in, min_amount_out, legs);
    }

    // Split route: execute each leg for its fraction of amount_in.
    if n > 1 {
        return execute_split(env, caller, amount_in, min_amount_out, legs);
    }

    // Single-leg: simple direct swap with fallback.
    let leg = legs.get(0).unwrap();
    let result = try_execute_leg(env, caller, &leg.dex_address, &token_in, &token_out, amount_in, min_amount_out);

    match result {
        Ok(out) => Ok(out),
        Err(_) => {
            emit_route_fallback(env, leg.dex_id.clone(), 1);
            // Attempt next-best DEX from the whitelist as fallback.
            let entries = get_dex_entries(env);
            for i in 0..entries.len() {
                let entry = entries.get(i).unwrap();
                if entry.dex_address == leg.dex_address || !entry.active {
                    continue;
                }
                let fb = try_execute_leg(env, caller, &entry.dex_address, &token_in, &token_out, amount_in, min_amount_out);
                if let Ok(out) = fb {
                    return Ok(out);
                }
                emit_route_fallback(env, entry.dex_id, 2);
            }
            Err(AggregatorError::AllRoutesFailed)
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn try_execute_leg(
    env: &Env,
    caller: &Address,
    dex_address: &Address,
    token_in: &Address,
    token_out: &Address,
    amount_in: i128,
    min_amount_out: i128,
) -> Result<i128, AggregatorError> {
    let result = env.try_invoke_contract::<i128, _>(
        dex_address,
        &soroban_sdk::symbol_short!("swap"),
        soroban_sdk::vec![
            env,
            caller.clone().into(),
            token_in.clone().into(),
            token_out.clone().into(),
            amount_in.into(),
            min_amount_out.into(),
        ],
    );
    match result {
        Ok(Ok(out)) if out >= min_amount_out => Ok(out),
        Ok(Ok(_)) => Err(AggregatorError::SlippageExceeded),
        _ => Err(AggregatorError::DexCallFailed),
    }
}

fn execute_split(
    env: &Env,
    caller: &Address,
    amount_in: i128,
    min_amount_out: i128,
    legs: &soroban_sdk::Vec<RouteLeg>,
) -> Result<i128, AggregatorError> {
    let mut total_out: i128 = 0;
    let n = legs.len();
    for i in 0..n {
        let leg = legs.get(i).unwrap();
        let leg_in = (amount_in * leg.split_bps as i128) / 10_000;
        // Each leg's minimum is proportional to the overall minimum.
        let leg_min = (min_amount_out * leg.split_bps as i128) / 10_000;
        let out = try_execute_leg(
            env, caller,
            &leg.dex_address,
            &leg.token_in, &leg.token_out,
            leg_in, leg_min,
        ).map_err(|_| {
            emit_route_fallback(env, leg.dex_id.clone(), 3);
            AggregatorError::DexCallFailed
        })?;
        total_out += out;
    }
    if total_out < min_amount_out {
        return Err(AggregatorError::SlippageExceeded);
    }
    Ok(total_out)
}

fn execute_multihop(
    env: &Env,
    caller: &Address,
    amount_in: i128,
    min_amount_out: i128,
    legs: &soroban_sdk::Vec<RouteLeg>,
) -> Result<i128, AggregatorError> {
    let n = legs.len();
    let mut current_in = amount_in;
    for i in 0..n {
        let leg = legs.get(i).unwrap();
        // Only enforce min_amount_out on the final leg.
        let leg_min = if i == n - 1 { min_amount_out } else { 1 };
        current_in = try_execute_leg(
            env, caller,
            &leg.dex_address,
            &leg.token_in, &leg.token_out,
            current_in, leg_min,
        ).map_err(|_| {
            emit_route_fallback(env, leg.dex_id.clone(), 4);
            AggregatorError::DexCallFailed
        })?;
    }
    Ok(current_in)
}

fn try_multihop_route(
    env: &Env,
    dex_entries: &soroban_sdk::Vec<crate::types::DexEntry>,
    token_in: &Address,
    token_out: &Address,
    amount_in: i128,
) -> Option<SwapRoute> {
    // Use the first active DEX for both legs.
    let mut best_dex: Option<(soroban_sdk::String, Address)> = None;
    for i in 0..dex_entries.len() {
        let e = dex_entries.get(i).unwrap();
        if e.active {
            best_dex = Some((e.dex_id, e.dex_address));
            break;
        }
    }
    let (dex_id, dex_addr) = best_dex?;

    // XLM as intermediate token (native asset represented as zero address placeholder).
    // In production this would be the actual XLM token contract address.
    let xlm = soroban_sdk::Address::from_str(env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")
        .ok()?;

    // Quote leg1: token_in → XLM
    let leg1_result = env.try_invoke_contract::<i128, _>(
        &dex_addr,
        &soroban_sdk::symbol_short!("get_swap"),
        soroban_sdk::vec![env, token_in.clone().into(), xlm.clone().into(), amount_in.into()],
    );
    let mid_out = match leg1_result { Ok(Ok(v)) if v > 0 => v, _ => return None };

    // Quote leg2: XLM → token_out
    let leg2_result = env.try_invoke_contract::<i128, _>(
        &dex_addr,
        &soroban_sdk::symbol_short!("get_swap"),
        soroban_sdk::vec![env, xlm.clone().into(), token_out.clone().into(), mid_out.into()],
    );
    let final_out = match leg2_result { Ok(Ok(v)) if v > 0 => v, _ => return None };

    let leg1 = RouteLeg {
        dex_id: dex_id.clone(),
        dex_address: dex_addr.clone(),
        token_in: token_in.clone(),
        token_out: xlm.clone(),
        split_bps: 10_000,
        expected_out: mid_out,
    };
    let leg2 = RouteLeg {
        dex_id: dex_id.clone(),
        dex_address: dex_addr.clone(),
        token_in: xlm,
        token_out: token_out.clone(),
        split_bps: 10_000,
        expected_out: final_out,
    };
    let mut legs = soroban_sdk::Vec::new(env);
    legs.push_back(leg1);
    legs.push_back(leg2);

    Some(SwapRoute {
        expected_out: final_out,
        dex_fees: estimate_dex_fee(final_out, 60), // two hops, 0.3 % each ≈ 0.6 %
        is_multi_hop: true,
        legs,
    })
}

/// Scale a full-amount quote linearly for a partial amount.
fn scale_quote(full_quote: i128, full_in: i128, partial_in: i128) -> i128 {
    if full_in == 0 { return 0; }
    (full_quote * partial_in) / full_in
}

/// Estimate DEX fee amount from output and fee_bps.
fn estimate_dex_fee(amount_out: i128, fee_bps: u32) -> i128 {
    (amount_out * fee_bps as i128) / 10_000
}

/// Crude price impact estimate: DEX fees / expected output.
fn compute_price_impact_bps(dex_fees: i128, expected_out: i128) -> u32 {
    if expected_out <= 0 { return 0; }
    ((dex_fees * 10_000) / expected_out) as u32
}
