use soroban_sdk::{Address, Env, String, symbol_short, vec};
use crate::types::SwapQuote;

/// Emitted after a swap is successfully executed.
///
/// Topics: ["swap_executed", caller]
/// Data: (token_in, token_out, amount_in, amount_out, protocol_fee, route_legs_count, price_impact_bps)
pub fn emit_swap_executed(
    env: &Env,
    caller: &Address,
    token_in: &Address,
    token_out: &Address,
    amount_in: i128,
    amount_out: i128,
    protocol_fee: i128,
    quote: &SwapQuote,
) {
    let topics = (symbol_short!("swap_exec"), caller.clone());
    env.events().publish(
        topics,
        (
            token_in.clone(),
            token_out.clone(),
            amount_in,
            amount_out,
            protocol_fee,
            quote.route.legs.len(),
            quote.price_impact_bps,
            quote.is_split,
        ),
    );
}

/// Emitted when a DEX is added to the whitelist.
pub fn emit_dex_added(env: &Env, dex_id: String, dex_address: Address) {
    let topics = (symbol_short!("dex_added"),);
    env.events().publish(topics, (dex_id, dex_address));
}

/// Emitted when a DEX is removed from the whitelist.
pub fn emit_dex_removed(env: &Env, dex_id: String) {
    let topics = (symbol_short!("dex_rmvd"),);
    env.events().publish(topics, (dex_id,));
}

/// Emitted when a route attempt fails and the aggregator falls back.
pub fn emit_route_fallback(env: &Env, failed_dex_id: String, reason_code: u32) {
    let topics = (symbol_short!("rt_fallbk"),);
    env.events().publish(topics, (failed_dex_id, reason_code));
}
