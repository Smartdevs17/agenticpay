use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AggregatorError {
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Caller is not the admin.
    Unauthorized = 2,
    /// No DEX is currently whitelisted.
    NoDexAvailable = 3,
    /// No viable route was found across all DEXs.
    NoRouteFound = 4,
    /// Slippage tolerance exceeds the 50 % hard cap.
    SlippageTooHigh = 5,
    /// Actual output fell below the caller's minimum.
    SlippageExceeded = 6,
    /// Simulated price impact exceeds 50 %.
    PriceImpactTooHigh = 7,
    /// Swap amount must be positive.
    InvalidAmount = 8,
    /// Requested fee exceeds the 2 % protocol cap.
    FeeTooHigh = 9,
    /// DEX cross-contract call failed.
    DexCallFailed = 10,
    /// All route attempts (primary + fallbacks) failed.
    AllRoutesFailed = 11,
    /// Insufficient liquidity in the chosen pool.
    InsufficientLiquidity = 12,
    /// Partial fill detected — pool could not absorb the full amount.
    PartialFillDetected = 13,
    /// Contract not yet initialized.
    NotInitialized = 14,
}
