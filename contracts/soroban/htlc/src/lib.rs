#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, vec, Address, BytesN, Env, IntoVal, Vec};

const BUMP_AMOUNT: u32 = 518_400;
const BUMP_THRESHOLD: u32 = 100_000;
const MAX_TIMELOCK_SECONDS: u64 = 2_592_000;
const MIN_TIMELOCK_SECONDS: u64 = 60;
const MAX_DISPUTE_WINDOW: u64 = 86_400;

#[contracttype]
#[derive(Clone)]
pub struct Swap {
    pub sender: Address,
    pub receiver: Address,
    pub token_a: Address,
    pub token_b: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub dispute_deadline: u64,
    pub status: SwapStatus,
    pub fee_bps: u32,
    pub fee_collector: Address,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum SwapStatus {
    Pending = 0,
    Claimed = 1,
    Refunded = 2,
    Disputed = 3,
}

#[contracttype]
pub enum DataKey {
    Swap(u64),
    SwapCount,
    Secret(u64),
    Admin,
    Initialized,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum HtlcError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    SwapNotFound = 4,
    InvalidAmount = 5,
    HashlockMismatch = 6,
    TimelockExpired = 7,
    TimelockNotExpired = 8,
    SwapNotPending = 9,
    AlreadyClaimed = 10,
    AlreadyRefunded = 11,
    InvalidTimelock = 12,
    InvalidDisputeWindow = 13,
    FeeTooHigh = 14,
    DisputeWindowNotElapsed = 15,
}

#[contract]
pub struct HtlcContract;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

#[contractimpl]
impl HtlcContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), HtlcError> {
        if env.storage().instance().has(&symbol_short!("init")) {
            return Err(HtlcError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&symbol_short!("admin"), &admin);
        env.storage().instance().set(&symbol_short!("init"), &true);
        env.storage().instance().set(&DataKey::SwapCount, &0u64);
        bump_instance(&env);
        Ok(())
    }

    pub fn admin(env: Env) -> Result<Address, HtlcError> {
        env.storage()
            .instance()
            .get::<_, Address>(&symbol_short!("admin"))
            .ok_or(HtlcError::NotInitialized)
    }

    fn _require_initialized(env: &Env) -> Result<(), HtlcError> {
        if !env.storage().instance().has(&symbol_short!("init")) {
            return Err(HtlcError::NotInitialized);
        }
        Ok(())
    }

    pub fn create_swap(
        env: Env,
        sender: Address,
        receiver: Address,
        token_a: Address,
        token_b: Address,
        amount_a: i128,
        amount_b: i128,
        hashlock: BytesN<32>,
        timelock_seconds: u64,
        dispute_window_seconds: u64,
        fee_bps: u32,
        fee_collector: Address,
    ) -> Result<u64, HtlcError> {
        Self::_require_initialized(&env)?;
        sender.require_auth();

        if amount_a <= 0 || amount_b <= 0 {
            return Err(HtlcError::InvalidAmount);
        }
        if timelock_seconds < MIN_TIMELOCK_SECONDS || timelock_seconds > MAX_TIMELOCK_SECONDS {
            return Err(HtlcError::InvalidTimelock);
        }
        if dispute_window_seconds > MAX_DISPUTE_WINDOW {
            return Err(HtlcError::InvalidDisputeWindow);
        }
        if fee_bps > 200 {
            return Err(HtlcError::FeeTooHigh);
        }

        let mut count: u64 = env.storage().instance().get(&DataKey::SwapCount).unwrap_or(0);
        count += 1;

        let ledger_timestamp = env.ledger().timestamp();
        let swap = Swap {
            sender,
            receiver,
            token_a,
            token_b,
            amount_a,
            amount_b,
            hashlock,
            timelock: ledger_timestamp + timelock_seconds,
            dispute_deadline: ledger_timestamp + timelock_seconds + dispute_window_seconds,
            status: SwapStatus::Pending,
            fee_bps,
            fee_collector,
        };

        env.storage().persistent().set(&DataKey::Swap(count), &swap);
        env.storage().instance().set(&DataKey::SwapCount, &count);

        let topics = (symbol_short!("swap"), symbol_short!("created"));
        env.events().publish(topics, (count, swap.amount_a, swap.amount_b, swap.timelock));

        bump_instance(&env);
        Ok(count)
    }

    pub fn claim(env: Env, swap_id: u64, preimage: BytesN<32>) -> Result<(), HtlcError> {
        Self::_require_initialized(&env)?;

        let mut swap = env.storage()
            .persistent()
            .get::<_, Swap>(&DataKey::Swap(swap_id))
            .ok_or(HtlcError::SwapNotFound)?;

        if swap.status != SwapStatus::Pending {
            return Err(HtlcError::SwapNotPending);
        }

        let ledger_timestamp = env.ledger().timestamp();
        if ledger_timestamp >= swap.timelock {
            return Err(HtlcError::TimelockExpired);
        }

        let computed_hash = env.crypto().sha256(&preimage.into_val(&env));
        if computed_hash != swap.hashlock {
            return Err(HtlcError::HashlockMismatch);
        }

        swap.status = SwapStatus::Claimed;
        env.storage().persistent().set(&DataKey::Swap(swap_id), &swap);
        env.storage().persistent().set(&DataKey::Secret(swap_id), &preimage);

        let receiver = swap.receiver.clone();
        let topics = (symbol_short!("swap"), symbol_short!("claimed"));
        env.events().publish(topics, (swap_id, receiver));

        bump_instance(&env);
        Ok(())
    }

    pub fn refund(env: Env, swap_id: u64) -> Result<(), HtlcError> {
        Self::_require_initialized(&env)?;

        let mut swap = env.storage()
            .persistent()
            .get::<_, Swap>(&DataKey::Swap(swap_id))
            .ok_or(HtlcError::SwapNotFound)?;

        if swap.status != SwapStatus::Pending && swap.status != SwapStatus::Disputed {
            return Err(HtlcError::SwapNotPending);
        }

        let ledger_timestamp = env.ledger().timestamp();
        if ledger_timestamp < swap.timelock {
            return Err(HtlcError::TimelockNotExpired);
        }

        if swap.status == SwapStatus::Disputed && ledger_timestamp < swap.dispute_deadline {
            return Err(HtlcError::DisputeWindowNotElapsed);
        }

        swap.status = SwapStatus::Refunded;
        env.storage().persistent().set(&DataKey::Swap(swap_id), &swap);

        let sender = swap.sender.clone();
        let topics = (symbol_short!("swap"), symbol_short!("refunded"));
        env.events().publish(topics, (swap_id, sender));

        bump_instance(&env);
        Ok(())
    }

    pub fn raise_dispute(env: Env, swap_id: u64) -> Result<(), HtlcError> {
        Self::_require_initialized(&env)?;

        let mut swap = env.storage()
            .persistent()
            .get::<_, Swap>(&DataKey::Swap(swap_id))
            .ok_or(HtlcError::SwapNotFound)?;

        if swap.status != SwapStatus::Pending {
            return Err(HtlcError::SwapNotPending);
        }

        let ledger_timestamp = env.ledger().timestamp();
        if ledger_timestamp >= swap.timelock {
            return Err(HtlcError::TimelockExpired);
        }

        swap.status = SwapStatus::Disputed;
        env.storage().persistent().set(&DataKey::Swap(swap_id), &swap);

        let topics = (symbol_short!("swap"), symbol_short!("disputed"));
        env.events().publish(topics, (swap_id,));

        bump_instance(&env);
        Ok(())
    }

    pub fn resolve_dispute(env: Env, admin: Address, swap_id: u64, release_to_receiver: bool) -> Result<(), HtlcError> {
        Self::_require_initialized(&env)?;

        let stored_admin: Address = env.storage()
            .instance()
            .get(&symbol_short!("admin"))
            .ok_or(HtlcError::NotInitialized)?;
        admin.require_auth();
        if admin != stored_admin {
            return Err(HtlcError::Unauthorized);
        }

        let mut swap = env.storage()
            .persistent()
            .get::<_, Swap>(&DataKey::Swap(swap_id))
            .ok_or(HtlcError::SwapNotFound)?;

        if swap.status != SwapStatus::Disputed {
            return Err(HtlcError::SwapNotPending);
        }

        if release_to_receiver {
            swap.status = SwapStatus::Claimed;
        } else {
            swap.status = SwapStatus::Refunded;
        }
        env.storage().persistent().set(&DataKey::Swap(swap_id), &swap);

        let topics = (symbol_short!("swap"), symbol_short!("resolved"));
        env.events().publish(topics, (swap_id, release_to_receiver));

        bump_instance(&env);
        Ok(())
    }

    pub fn get_swap(env: Env, swap_id: u64) -> Result<Swap, HtlcError> {
        env.storage()
            .persistent()
            .get::<_, Swap>(&DataKey::Swap(swap_id))
            .ok_or(HtlcError::SwapNotFound)
    }

    pub fn get_swap_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::SwapCount).unwrap_or(0)
    }

    pub fn get_secret(env: Env, swap_id: u64) -> Result<BytesN<32>, HtlcError> {
        env.storage()
            .persistent()
            .get::<_, BytesN<32>>(&DataKey::Secret(swap_id))
            .ok_or(HtlcError::SwapNotFound)
    }

    pub fn version(env: Env) -> u32 {
        1
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, vec, BytesN, Env, IntoVal};

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        HtlcContract::initialize(env.clone(), admin.clone()).unwrap();
        (env, admin, alice, bob)
    }

    fn make_hashlock(env: &Env, secret: &BytesN<32>) -> BytesN<32> {
        env.crypto().sha256(&secret.into_val(env))
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let admin = Address::generate(&env);
        assert!(HtlcContract::initialize(env.clone(), admin.clone()).is_ok());
        assert!(HtlcContract::initialize(env, admin).is_err());
    }

    #[test]
    fn test_create_and_claim_swap() {
        let (env, _admin, alice, bob) = setup();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        let fee_collector = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[1u8; 32]);
        let hashlock = make_hashlock(&env, &secret);

        let timelock_seconds: u64 = 3600;
        let dispute_window: u64 = 3600;

        let swap_id = HtlcContract::create_swap(
            env.clone(),
            alice.clone(),
            bob.clone(),
            token_a.clone(),
            token_b.clone(),
            1000,
            950,
            hashlock.clone(),
            timelock_seconds,
            dispute_window,
            30,
            fee_collector,
        ).unwrap();

        assert_eq!(swap_id, 1);

        HtlcContract::claim(env.clone(), swap_id, secret).unwrap();

        let swap = HtlcContract::get_swap(env.clone(), swap_id).unwrap();
        assert_eq!(swap.status, SwapStatus::Claimed);

        let stored_secret = HtlcContract::get_secret(env.clone(), swap_id).unwrap();
        assert_eq!(stored_secret, secret);
    }

    #[test]
    fn test_refund_after_timelock() {
        let (env, _admin, alice, bob) = setup();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        let fee_collector = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[2u8; 32]);
        let hashlock = make_hashlock(&env, &secret);

        let swap_id = HtlcContract::create_swap(
            env.clone(),
            alice.clone(),
            bob.clone(),
            token_a.clone(),
            token_b.clone(),
            1000,
            950,
            hashlock,
            3600,
            3600,
            30,
            fee_collector,
        ).unwrap();

        env.ledger().set_timestamp(env.ledger().timestamp() + 7200);

        HtlcContract::refund(env.clone(), swap_id).unwrap();
        let swap = HtlcContract::get_swap(env, swap_id).unwrap();
        assert_eq!(swap.status, SwapStatus::Refunded);
    }

    #[test]
    fn test_claim_rejects_wrong_preimage() {
        let (env, _admin, alice, bob) = setup();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        let fee_collector = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[3u8; 32]);
        let hashlock = make_hashlock(&env, &secret);

        let swap_id = HtlcContract::create_swap(
            env.clone(),
            alice.clone(),
            bob.clone(),
            token_a,
            token_b,
            1000,
            950,
            hashlock,
            3600,
            3600,
            30,
            fee_collector,
        ).unwrap();

        let wrong_secret = BytesN::from_array(&env, &[4u8; 32]);
        let result = HtlcContract::claim(env.clone(), swap_id, wrong_secret);
        assert_eq!(result, Err(HtlcError::HashlockMismatch));
    }

    #[test]
    fn test_raise_dispute_and_resolve() {
        let (env, admin, alice, bob) = setup();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        let fee_collector = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[5u8; 32]);
        let hashlock = make_hashlock(&env, &secret);

        let swap_id = HtlcContract::create_swap(
            env.clone(),
            alice,
            bob,
            token_a,
            token_b,
            1000,
            950,
            hashlock,
            3600,
            3600,
            30,
            fee_collector,
        ).unwrap();

        HtlcContract::raise_dispute(env.clone(), swap_id).unwrap();
        let swap = HtlcContract::get_swap(env.clone(), swap_id).unwrap();
        assert_eq!(swap.status, SwapStatus::Disputed);

        HtlcContract::resolve_dispute(env.clone(), admin, swap_id, true).unwrap();
        let swap = HtlcContract::get_swap(env, swap_id).unwrap();
        assert_eq!(swap.status, SwapStatus::Claimed);
    }

    #[test]
    fn test_claim_fails_after_timelock() {
        let (env, _admin, alice, bob) = setup();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        let fee_collector = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[6u8; 32]);
        let hashlock = make_hashlock(&env, &secret);

        let swap_id = HtlcContract::create_swap(
            env.clone(),
            alice,
            bob,
            token_a,
            token_b,
            1000,
            950,
            hashlock,
            3600,
            3600,
            30,
            fee_collector,
        ).unwrap();

        env.ledger().set_timestamp(env.ledger().timestamp() + 4000);
        let result = HtlcContract::claim(env.clone(), swap_id, secret);
        assert_eq!(result, Err(HtlcError::TimelockExpired));
    }

    #[test]
    fn test_version() {
        let (env, ..) = setup();
        assert_eq!(HtlcContract::version(env), 1);
    }

    #[test]
    fn test_double_claim_rejected() {
        let (env, _admin, alice, bob) = setup();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        let fee_collector = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[7u8; 32]);
        let hashlock = make_hashlock(&env, &secret);

        let swap_id = HtlcContract::create_swap(
            env.clone(),
            alice,
            bob,
            token_a,
            token_b,
            1000,
            950,
            hashlock,
            3600,
            3600,
            30,
            fee_collector,
        ).unwrap();

        HtlcContract::claim(env.clone(), swap_id, secret.clone()).unwrap();
        let result = HtlcContract::claim(env.clone(), swap_id, secret);
        assert_eq!(result, Err(HtlcError::SwapNotPending));
    }
}
