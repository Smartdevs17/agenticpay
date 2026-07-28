use soroban_sdk::{Address, Env, String, Vec};
use crate::common::{self, *};

pub fn create_wallet(
    env: &Env,
    creator: Address,
    signers: Vec<Address>,
    threshold: u32,
    timeout_ledgers: u64,
) -> u64 {
    common::_require_not_paused(env);
    creator.require_auth();
    common::_acquire_lock(env);

    assert!(signers.len() >= 2, "At least 2 signers required");
    assert!(threshold >= 1, "Threshold must be at least 1");
    assert!(
        threshold as usize <= signers.len(),
        "Threshold cannot exceed number of signers"
    );

    let mut count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::MultisigWalletCount)
        .unwrap_or(0);
    count += 1;

    let wallet = MultisigWallet {
        id: count,
        signers,
        threshold,
        timeout_ledgers,
        active: true,
    };

    env.storage()
        .persistent()
        .set(&DataKey::MultisigWallet(count), &wallet);
    env.storage()
        .instance()
        .set(&DataKey::MultisigWalletCount, &count);

    env.events().publish(
        (symbol_short!("msig"), symbol_short!("created")),
        (count, threshold),
    );

    common::_release_lock(env);
    count
}

pub fn get_wallet(env: &Env, wallet_id: u64) -> MultisigWallet {
    env.storage()
        .persistent()
        .get(&DataKey::MultisigWallet(wallet_id))
        .expect("Multisig wallet not found")
}

pub fn add_signer(
    env: &Env,
    authorizer: Address,
    wallet_id: u64,
    new_signer: Address,
) {
    common::_require_not_paused(env);
    authorizer.require_auth();
    common::_acquire_lock(env);

    let mut wallet: MultisigWallet = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigWallet(wallet_id))
        .expect("Multisig wallet not found");

    assert!(wallet.active, "Wallet is inactive");

    let mut is_signer = false;
    for i in 0..wallet.signers.len() {
        if wallet.signers.get(i).unwrap() == authorizer {
            is_signer = true;
            break;
        }
    }
    assert!(is_signer, "Authorizer is not a signer");

    wallet.signers.push_back(new_signer.clone());
    env.storage()
        .persistent()
        .set(&DataKey::MultisigWallet(wallet_id), &wallet);

    env.events().publish(
        (symbol_short!("msig"), symbol_short!("sgn_add")),
        (wallet_id, new_signer),
    );

    common::_release_lock(env);
}

pub fn remove_signer(
    env: &Env,
    authorizer: Address,
    wallet_id: u64,
    signer_to_remove: Address,
) {
    common::_require_not_paused(env);
    authorizer.require_auth();
    common::_acquire_lock(env);

    let mut wallet: MultisigWallet = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigWallet(wallet_id))
        .expect("Multisig wallet not found");

    assert!(wallet.active, "Wallet is inactive");

    let mut is_authorizer_signer = false;
    let mut remove_idx: Option<u32> = None;
    for i in 0..wallet.signers.len() {
        let s = wallet.signers.get(i).unwrap();
        if s == authorizer {
            is_authorizer_signer = true;
        }
        if s == signer_to_remove {
            remove_idx = Some(i);
        }
    }
    assert!(is_authorizer_signer, "Authorizer is not a signer");
    assert!(remove_idx.is_some(), "Signer to remove not found");

    let new_len = wallet.signers.len() - 1;
    assert!(new_len >= 2, "Cannot reduce below 2 signers");
    assert!(
        wallet.threshold as usize <= new_len,
        "Removal would make threshold unreachable"
    );

    let mut new_signers = Vec::new(env);
    for i in 0..wallet.signers.len() {
        if Some(i) != remove_idx {
            new_signers.push_back(wallet.signers.get(i).unwrap());
        }
    }
    wallet.signers = new_signers;

    env.storage()
        .persistent()
        .set(&DataKey::MultisigWallet(wallet_id), &wallet);

    env.events().publish(
        (symbol_short!("msig"), symbol_short!("sgn_rem")),
        (wallet_id, signer_to_remove),
    );

    common::_release_lock(env);
}

pub fn create_proposal(
    env: &Env,
    proposer: Address,
    wallet_id: u64,
    amount: i128,
    recipient: Address,
    description: String,
) -> u64 {
    common::_require_not_paused(env);
    proposer.require_auth();
    common::_acquire_lock(env);

    let wallet: MultisigWallet = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigWallet(wallet_id))
        .expect("Multisig wallet not found");
    assert!(wallet.active, "Wallet is inactive");
    assert!(amount > 0, "Amount must be positive");

    let mut is_signer = false;
    for i in 0..wallet.signers.len() {
        if wallet.signers.get(i).unwrap() == proposer {
            is_signer = true;
            break;
        }
    }
    assert!(is_signer, "Proposer is not a signer of this wallet");

    let mut count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::MultisigProposalCount)
        .unwrap_or(0);
    count += 1;

    let now = env.ledger().timestamp();
    let expires_at = if wallet.timeout_ledgers > 0 {
        now + wallet.timeout_ledgers
    } else {
        0
    };

    let mut initial_approvals = Vec::new(env);
    initial_approvals.push_back(proposer.clone());

    let proposal = MultisigProposal {
        id: count,
        wallet_id,
        amount,
        recipient: recipient.clone(),
        description,
        status: MultisigProposalStatus::Pending,
        approvals: initial_approvals,
        rejections: Vec::new(env),
        created_at: now,
        expires_at,
    };

    env.storage()
        .persistent()
        .set(&DataKey::MultisigProposal(count), &proposal);
    env.storage()
        .instance()
        .set(&DataKey::MultisigProposalCount, &count);

    env.events().publish(
        (symbol_short!("msig"), symbol_short!("prop")),
        (count, wallet_id, amount, recipient),
    );

    common::_release_lock(env);
    count
}

pub fn approve_proposal(env: &Env, signer: Address, proposal_id: u64) {
    common::_require_not_paused(env);
    signer.require_auth();
    common::_acquire_lock(env);

    let mut proposal: MultisigProposal = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigProposal(proposal_id))
        .expect("Proposal not found");

    assert!(
        proposal.status == MultisigProposalStatus::Pending,
        "Proposal is not pending"
    );

    let wallet: MultisigWallet = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigWallet(proposal.wallet_id))
        .expect("Wallet not found");

    if proposal.expires_at > 0 && env.ledger().timestamp() >= proposal.expires_at {
        proposal.status = MultisigProposalStatus::Expired;
        env.storage()
            .persistent()
            .set(&DataKey::MultisigProposal(proposal_id), &proposal);
        common::_release_lock(env);
        panic!("Proposal has expired");
    }

    let mut is_signer = false;
    for i in 0..wallet.signers.len() {
        if wallet.signers.get(i).unwrap() == signer {
            is_signer = true;
            break;
        }
    }
    assert!(is_signer, "Not a signer of this wallet");

    for i in 0..proposal.approvals.len() {
        if proposal.approvals.get(i).unwrap() == signer {
            common::_release_lock(env);
            return;
        }
    }

    proposal.approvals.push_back(signer.clone());

    if proposal.approvals.len() >= wallet.threshold {
        proposal.status = MultisigProposalStatus::Executed;
        env.events().publish(
            (symbol_short!("msig"), symbol_short!("exec")),
            (proposal_id, proposal.wallet_id, proposal.amount, proposal.recipient.clone()),
        );
    }

    env.storage()
        .persistent()
        .set(&DataKey::MultisigProposal(proposal_id), &proposal);

    common::_release_lock(env);
}

pub fn reject_proposal(env: &Env, signer: Address, proposal_id: u64) {
    common::_require_not_paused(env);
    signer.require_auth();
    common::_acquire_lock(env);

    let mut proposal: MultisigProposal = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigProposal(proposal_id))
        .expect("Proposal not found");

    assert!(
        proposal.status == MultisigProposalStatus::Pending,
        "Proposal is not pending"
    );

    let wallet: MultisigWallet = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigWallet(proposal.wallet_id))
        .expect("Wallet not found");

    let mut is_signer = false;
    for i in 0..wallet.signers.len() {
        if wallet.signers.get(i).unwrap() == signer {
            is_signer = true;
            break;
        }
    }
    assert!(is_signer, "Not a signer of this wallet");

    for i in 0..proposal.rejections.len() {
        if proposal.rejections.get(i).unwrap() == signer {
            common::_release_lock(env);
            return;
        }
    }

    proposal.rejections.push_back(signer);

    let blocking = wallet.signers.len() - wallet.threshold + 1;
    if proposal.rejections.len() >= blocking {
        proposal.status = MultisigProposalStatus::Rejected;
        env.events().publish(
            (symbol_short!("msig"), symbol_short!("reject")),
            (proposal_id, proposal.wallet_id),
        );
    }

    env.storage()
        .persistent()
        .set(&DataKey::MultisigProposal(proposal_id), &proposal);

    common::_release_lock(env);
}

pub fn cancel_proposal(env: &Env, signer: Address, proposal_id: u64) {
    common::_require_not_paused(env);
    signer.require_auth();
    common::_acquire_lock(env);

    let mut proposal: MultisigProposal = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigProposal(proposal_id))
        .expect("Proposal not found");

    assert!(
        proposal.status == MultisigProposalStatus::Pending,
        "Only pending proposals can be cancelled"
    );

    let wallet: MultisigWallet = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigWallet(proposal.wallet_id))
        .expect("Wallet not found");

    let mut is_signer = false;
    for i in 0..wallet.signers.len() {
        if wallet.signers.get(i).unwrap() == signer {
            is_signer = true;
            break;
        }
    }
    assert!(is_signer, "Not a signer of this wallet");

    proposal.status = MultisigProposalStatus::Cancelled;

    env.storage()
        .persistent()
        .set(&DataKey::MultisigProposal(proposal_id), &proposal);

    env.events().publish(
        (symbol_short!("msig"), symbol_short!("cancel")),
        (proposal_id, proposal.wallet_id),
    );

    common::_release_lock(env);
}

pub fn get_proposal(env: &Env, proposal_id: u64) -> MultisigProposal {
    env.storage()
        .persistent()
        .get(&DataKey::MultisigProposal(proposal_id))
        .expect("Proposal not found")
}

pub fn check_expiry(env: &Env, proposal_id: u64) -> bool {
    common::_acquire_lock(env);

    let mut proposal: MultisigProposal = env
        .storage()
        .persistent()
        .get(&DataKey::MultisigProposal(proposal_id))
        .expect("Proposal not found");

    if proposal.status != MultisigProposalStatus::Pending || proposal.expires_at == 0 {
        common::_release_lock(env);
        return false;
    }

    if env.ledger().timestamp() < proposal.expires_at {
        common::_release_lock(env);
        return false;
    }

    proposal.status = MultisigProposalStatus::Expired;
    env.storage()
        .persistent()
        .set(&DataKey::MultisigProposal(proposal_id), &proposal);

    env.events().publish(
        (symbol_short!("msig"), symbol_short!("expired")),
        (proposal_id, proposal.wallet_id),
    );

    common::_release_lock(env);
    true
}
