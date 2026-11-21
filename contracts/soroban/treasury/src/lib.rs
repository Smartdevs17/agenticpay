#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec, Map};

const BUMP_AMOUNT: u32 = 518_400;
const BUMP_THRESHOLD: u32 = 100_000;
const MAX_SIGNERS: u32 = 20;
const MIN_THRESHOLD: u32 = 1;
const MAX_TIMELOCK_SECONDS: u64 = 604_800;
const MIN_TIMELOCK_SECONDS: u64 = 60;
const HIGH_VALUE_THRESHOLD: i128 = 100_000_000_000;

#[contracttype]
#[derive(Clone)]
pub struct TreasuryConfig {
    pub signers: Vec<Address>,
    pub threshold: u32,
    pub regular_timelock: u64,
    pub high_value_timelock: u64,
    pub high_value_threshold: i128,
    pub emergency_cancel_threshold: u32,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum ProposalStatus {
    Pending = 0,
    Approved = 1,
    Executed = 2,
    Rejected = 3,
    Cancelled = 4,
    Expired = 5,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub description: String,
    pub target: Address,
    pub amount: i128,
    pub token: Option<Address>,
    pub calldata: Vec<u8>,
    pub status: ProposalStatus,
    pub approvals: Map<Address, bool>,
    pub rejections: Map<Address, bool>,
    pub approval_count: u32,
    pub rejection_count: u32,
    pub created_at: u64,
    pub timelock_delay: u64,
    pub execute_after: u64,
}

#[contracttype]
pub enum DataKey {
    Config,
    Proposal(u64),
    ProposalCount,
    Initialized,
    Admin,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TreasuryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    NotSigner = 4,
    ProposalNotFound = 5,
    InvalidThreshold = 6,
    InvalidTimelock = 7,
    TooManySigners = 8,
    DuplicateSigner = 9,
    InsufficientSigners = 10,
    AlreadyVoted = 11,
    ProposalNotPending = 12,
    ProposalNotApproved = 13,
    TimelockNotElapsed = 14,
    AlreadyExecuted = 15,
    AlreadyCancelled = 16,
    NotProposer = 17,
    InsufficientEmergencyApprovals = 18,
    CannotExecutePending = 19,
    MinTimelockNotMet = 20,
    FeeTooHigh = 21,
}

#[contract]
pub struct TreasuryContract;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

#[contractimpl]
impl TreasuryContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        signers: Vec<Address>,
        threshold: u32,
        regular_timelock: u64,
        high_value_timelock: u64,
        emergency_cancel_threshold: u32,
    ) -> Result<(), TreasuryError> {
        if env.storage().instance().has(&symbol_short!("init")) {
            return Err(TreasuryError::AlreadyInitialized);
        }
        admin.require_auth();

        let signer_count = signers.len();
        if signer_count < MIN_THRESHOLD as u32 || signer_count > MAX_SIGNERS {
            return Err(TreasuryError::TooManySigners);
        }
        if threshold < MIN_THRESHOLD || threshold > signer_count {
            return Err(TreasuryError::InvalidThreshold);
        }
        if emergency_cancel_threshold < threshold || emergency_cancel_threshold > signer_count {
            return Err(TreasuryError::InvalidThreshold);
        }
        if regular_timelock < MIN_TIMELOCK_SECONDS || regular_timelock > MAX_TIMELOCK_SECONDS {
            return Err(TreasuryError::InvalidTimelock);
        }
        if high_value_timelock < MIN_TIMELOCK_SECONDS || high_value_timelock > MAX_TIMELOCK_SECONDS {
            return Err(TreasuryError::InvalidTimelock);
        }
        if high_value_timelock < regular_timelock {
            return Err(TreasuryError::InvalidTimelock);
        }

        let mut seen = Map::new(&env);
        for i in 0..signer_count {
            let signer = signers.get(i).unwrap();
            if seen.contains_key(signer.clone()) {
                return Err(TreasuryError::DuplicateSigner);
            }
            seen.set(signer, true);
        }

        let config = TreasuryConfig {
            signers,
            threshold,
            regular_timelock,
            high_value_timelock,
            high_value_threshold: HIGH_VALUE_THRESHOLD,
            emergency_cancel_threshold,
        };

        env.storage().instance().set(&symbol_short!("admin"), &admin);
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&symbol_short!("init"), &true);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        bump_instance(&env);
        Ok(())
    }

    fn _require_initialized(env: &Env) -> Result<(), TreasuryError> {
        if !env.storage().instance().has(&symbol_short!("init")) {
            return Err(TreasuryError::NotInitialized);
        }
        Ok(())
    }

    fn _get_config(env: &Env) -> TreasuryConfig {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn admin(env: Env) -> Result<Address, TreasuryError> {
        env.storage()
            .instance()
            .get::<_, Address>(&symbol_short!("admin"))
            .ok_or(TreasuryError::NotInitialized)
    }

    pub fn get_config(env: Env) -> Result<TreasuryConfig, TreasuryError> {
        Self::_require_initialized(&env)?;
        Ok(Self::_get_config(&env))
    }

    pub fn propose(
        env: Env,
        proposer: Address,
        description: String,
        target: Address,
        amount: i128,
        token: Option<Address>,
        calldata: Vec<u8>,
    ) -> Result<u64, TreasuryError> {
        Self::_require_initialized(&env)?;
        proposer.require_auth();

        let config = Self::_get_config(&env);
        let is_signer = config.signers.iter().any(|s| s == proposer);
        if !is_signer {
            return Err(TreasuryError::NotSigner);
        }

        let timelock = if amount >= config.high_value_threshold {
            config.high_value_timelock
        } else {
            config.regular_timelock
        };

        let mut count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        count += 1;
        let ledger_time = env.ledger().timestamp();
        let execute_after = ledger_time + timelock;

        let proposal = Proposal {
            id: count,
            proposer: proposer.clone(),
            description,
            target,
            amount,
            token,
            calldata,
            status: ProposalStatus::Pending,
            approvals: Map::new(&env),
            rejections: Map::new(&env),
            approval_count: 0,
            rejection_count: 0,
            created_at: ledger_time,
            timelock_delay: timelock,
            execute_after,
        };

        env.storage().persistent().set(&DataKey::Proposal(count), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &count);

        let topics = (symbol_short!("treasury"), symbol_short!("proposed"));
        env.events().publish(topics, (count, proposer, amount, execute_after));

        bump_instance(&env);
        Ok(count)
    }

    pub fn approve(env: Env, signer: Address, proposal_id: u64) -> Result<(), TreasuryError> {
        Self::_require_initialized(&env)?;
        signer.require_auth();

        let config = Self::_get_config(&env);
        let is_signer = config.signers.iter().any(|s| s == signer);
        if !is_signer {
            return Err(TreasuryError::NotSigner);
        }

        let mut proposal = env.storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(proposal_id))
            .ok_or(TreasuryError::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Pending {
            return Err(TreasuryError::ProposalNotPending);
        }
        if proposal.approvals.contains_key(signer.clone()) || proposal.rejections.contains_key(signer.clone()) {
            return Err(TreasuryError::AlreadyVoted);
        }

        proposal.approvals.set(signer.clone(), true);
        proposal.approval_count += 1;

        if proposal.approval_count >= config.threshold {
            proposal.status = ProposalStatus::Approved;
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        let topics = (symbol_short!("treasury"), symbol_short!("approved"));
        env.events().publish(topics, (proposal_id, signer, proposal.approval_count));

        bump_instance(&env);
        Ok(())
    }

    pub fn reject(env: Env, signer: Address, proposal_id: u64) -> Result<(), TreasuryError> {
        Self::_require_initialized(&env)?;
        signer.require_auth();

        let config = Self::_get_config(&env);
        let is_signer = config.signers.iter().any(|s| s == signer);
        if !is_signer {
            return Err(TreasuryError::NotSigner);
        }

        let mut proposal = env.storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(proposal_id))
            .ok_or(TreasuryError::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Pending && proposal.status != ProposalStatus::Approved {
            return Err(TreasuryError::ProposalNotPending);
        }
        if proposal.approvals.contains_key(signer.clone()) || proposal.rejections.contains_key(signer.clone()) {
            return Err(TreasuryError::AlreadyVoted);
        }

        proposal.rejections.set(signer.clone(), true);
        proposal.rejection_count += 1;

        let remaining = config.signers.len() - proposal.rejection_count;
        if remaining < config.threshold {
            proposal.status = ProposalStatus::Rejected;
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        let topics = (symbol_short!("treasury"), symbol_short!("rejected"));
        env.events().publish(topics, (proposal_id, signer));

        bump_instance(&env);
        Ok(())
    }

    pub fn execute(env: Env, proposal_id: u64) -> Result<(), TreasuryError> {
        Self::_require_initialized(&env)?;

        let proposal = env.storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(proposal_id))
            .ok_or(TreasuryError::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Approved {
            return Err(TreasuryError::ProposalNotApproved);
        }

        let ledger_time = env.ledger().timestamp();
        if ledger_time < proposal.execute_after {
            return Err(TreasuryError::TimelockNotElapsed);
        }

        let mut executable = proposal.clone();
        executable.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &executable);

        let topics = (symbol_short!("treasury"), symbol_short!("executed"));
        env.events().publish(topics, (proposal_id, proposal.target));

        bump_instance(&env);
        Ok(())
    }

    pub fn cancel(env: Env, caller: Address, proposal_id: u64) -> Result<(), TreasuryError> {
        Self::_require_initialized(&env)?;
        caller.require_auth();

        let mut proposal = env.storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(proposal_id))
            .ok_or(TreasuryError::ProposalNotFound)?;

        if proposal.status == ProposalStatus::Executed {
            return Err(TreasuryError::AlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Cancelled {
            return Err(TreasuryError::AlreadyCancelled);
        }

        let config = Self::_get_config(&env);
        let is_proposer = proposal.proposer == caller;
        let is_signer = config.signers.iter().any(|s| s == caller);

        if is_proposer {
            proposal.status = ProposalStatus::Cancelled;
        } else if is_signer && proposal.status == ProposalStatus::Pending {
            proposal.status = ProposalStatus::Cancelled;
        } else {
            return Err(TreasuryError::Unauthorized);
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        let topics = (symbol_short!("treasury"), symbol_short!("cancelled"));
        env.events().publish(topics, (proposal_id, caller));

        bump_instance(&env);
        Ok(())
    }

    pub fn emergency_cancel(env: Env, caller: Address, proposal_id: u64) -> Result<(), TreasuryError> {
        Self::_require_initialized(&env)?;
        caller.require_auth();

        let config = Self::_get_config(&env);
        let is_signer = config.signers.iter().any(|s| s == caller);
        if !is_signer {
            return Err(TreasuryError::NotSigner);
        }

        let mut proposal = env.storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(proposal_id))
            .ok_or(TreasuryError::ProposalNotFound)?;

        if proposal.status == ProposalStatus::Executed {
            return Err(TreasuryError::AlreadyExecuted);
        }

        proposal.rejections.set(caller.clone(), true);
        proposal.rejection_count += 1;

        if proposal.rejection_count >= config.emergency_cancel_threshold {
            proposal.status = ProposalStatus::Cancelled;
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        let topics = (symbol_short!("treasury"), symbol_short!("emergency_cancel"));
        env.events().publish(topics, (proposal_id, caller, proposal.rejection_count));

        bump_instance(&env);
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, TreasuryError> {
        env.storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(proposal_id))
            .ok_or(TreasuryError::ProposalNotFound)
    }

    pub fn get_proposal_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0)
    }

    pub fn version(env: Env) -> u32 {
        1
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Map, String};

    fn setup() -> (Env, Address, Vec<Address>, Address) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        let signers = vec![&env, alice.clone(), bob.clone(), carol.clone()];

        TreasuryContract::initialize(
            env.clone(),
            admin.clone(),
            signers.clone(),
            2,
            3600,
            86400,
            3,
        ).unwrap();

        (env, admin, signers, alice)
    }

    #[test]
    fn test_initialize_and_config() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let signers = vec![&env, alice, bob];

        TreasuryContract::initialize(
            env.clone(),
            admin.clone(),
            signers.clone(),
            2,
            3600,
            86400,
            2,
        ).unwrap();

        let config = TreasuryContract::get_config(env.clone()).unwrap();
        assert_eq!(config.threshold, 2);
        assert_eq!(config.signers.len(), 2);
    }

    #[test]
    fn test_propose_and_approve() {
        let (env, _admin, signers, alice) = setup();
        let target = Address::generate(&env);

        let pid = TreasuryContract::propose(
            env.clone(),
            alice.clone(),
            String::from_str(&env, "test proposal"),
            target,
            1000,
            None,
            vec![&env],
        ).unwrap();

        assert_eq!(pid, 1);

        let bob = signers.get(1).unwrap();
        TreasuryContract::approve(env.clone(), bob, pid).unwrap();

        let proposal = TreasuryContract::get_proposal(env.clone(), pid).unwrap();
        assert_eq!(proposal.approval_count, 1);
        assert_eq!(proposal.status, ProposalStatus::Pending);

        TreasuryContract::approve(env.clone(), alice, pid).unwrap();
        let proposal = TreasuryContract::get_proposal(env.clone(), pid).unwrap();
        assert_eq!(proposal.approval_count, 2);
        assert_eq!(proposal.status, ProposalStatus::Approved);
    }

    #[test]
    fn test_execute_after_timelock() {
        let (env, _admin, signers, alice) = setup();
        let target = Address::generate(&env);

        let pid = TreasuryContract::propose(
            env.clone(),
            alice.clone(),
            String::from_str(&env, "exec proposal"),
            target,
            1000,
            None,
            vec![&env],
        ).unwrap();

        TreasuryContract::approve(env.clone(), alice, pid).unwrap();
        let bob = signers.get(1).unwrap();
        TreasuryContract::approve(env.clone(), bob, pid).unwrap();

        let proposal = TreasuryContract::get_proposal(env.clone(), pid).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Approved);

        env.ledger().set_timestamp(env.ledger().timestamp() + 7200);

        TreasuryContract::execute(env.clone(), pid).unwrap();
        let proposal = TreasuryContract::get_proposal(env.clone(), pid).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Executed);
    }

    #[test]
    fn test_execute_before_timelock_fails() {
        let (env, _admin, signers, alice) = setup();
        let target = Address::generate(&env);

        let pid = TreasuryContract::propose(
            env.clone(),
            alice.clone(),
            String::from_str(&env, "early exec"),
            target,
            1000,
            None,
            vec![&env],
        ).unwrap();

        TreasuryContract::approve(env.clone(), alice, pid).unwrap();
        let bob = signers.get(1).unwrap();
        TreasuryContract::approve(env.clone(), bob, pid).unwrap();

        let result = TreasuryContract::execute(env.clone(), pid);
        assert_eq!(result, Err(TreasuryError::TimelockNotElapsed));
    }

    #[test]
    fn test_reject_proposal() {
        let (env, _admin, signers, alice) = setup();
        let target = Address::generate(&env);

        let pid = TreasuryContract::propose(
            env.clone(),
            alice,
            String::from_str(&env, "reject test"),
            target,
            1000,
            None,
            vec![&env],
        ).unwrap();

        let bob = signers.get(1).unwrap();
        let carol = signers.get(2).unwrap();

        TreasuryContract::reject(env.clone(), bob, pid).unwrap();
        let proposal = TreasuryContract::get_proposal(env.clone(), pid).unwrap();
        assert_eq!(proposal.rejection_count, 1);

        TreasuryContract::reject(env.clone(), carol, pid).unwrap();
        let proposal = TreasuryContract::get_proposal(env, pid).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Rejected);
    }

    #[test]
    fn test_cancel_by_proposer() {
        let (env, _admin, _signers, alice) = setup();
        let target = Address::generate(&env);

        let pid = TreasuryContract::propose(
            env.clone(),
            alice.clone(),
            String::from_str(&env, "cancel test"),
            target,
            1000,
            None,
            vec![&env],
        ).unwrap();

        TreasuryContract::cancel(env.clone(), alice, pid).unwrap();
        let proposal = TreasuryContract::get_proposal(env, pid).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn test_version() {
        let (env, ..) = setup();
        assert_eq!(TreasuryContract::version(env), 1);
    }
}
