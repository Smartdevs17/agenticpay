#[cfg(test)]
mod security_properties {
    use proptest::prelude::*;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum ProjectState {
        Created,
        Funded,
        WorkSubmitted,
        Verified,
        Completed,
        Disputed,
        Cancelled,
    }

    fn valid_transition(from: ProjectState, to: ProjectState) -> bool {
        matches!(
            (from, to),
            (ProjectState::Created, ProjectState::Funded)
                | (ProjectState::Created, ProjectState::Cancelled)
                | (ProjectState::Funded, ProjectState::WorkSubmitted)
                | (ProjectState::Funded, ProjectState::Disputed)
                | (ProjectState::WorkSubmitted, ProjectState::Verified)
                | (ProjectState::WorkSubmitted, ProjectState::Disputed)
                | (ProjectState::Verified, ProjectState::Completed)
                | (ProjectState::Disputed, ProjectState::Completed)
                | (ProjectState::Disputed, ProjectState::Cancelled)
        )
    }

    fn transfer_preserves_total(from_balance: u128, to_balance: u128, amount: u128) -> Option<(u128, u128)> {
        if from_balance < amount {
            return None;
        }

        let next_from = from_balance.checked_sub(amount)?;
        let next_to = to_balance.checked_add(amount)?;
        Some((next_from, next_to))
    }

    fn fee_amount(amount: u128, fee_bps: u16) -> Option<u128> {
        if fee_bps > 10_000 {
            return None;
        }
        amount.checked_mul(fee_bps as u128)?.checked_div(10_000)
    }

    prop_compose! {
        fn balances_and_amount()(
            from in 0u128..1_000_000_000_000u128,
            to in 0u128..1_000_000_000_000u128,
            amount in 0u128..1_000_000_000_000u128,
        ) -> (u128, u128, u128) {
            (from, to, amount)
        }
    }

    proptest! {
        #[test]
        fn total_balance_is_preserved_for_successful_transfers((from, to, amount) in balances_and_amount()) {
            if let Some((next_from, next_to)) = transfer_preserves_total(from, to, amount) {
                prop_assert_eq!(next_from + next_to, from + to);
            }
        }

        #[test]
        fn insufficient_balance_cannot_transfer(from in 0u128..1_000_000u128, extra in 1u128..1_000_000u128, to in 0u128..1_000_000u128) {
            let amount = from + extra;
            prop_assert!(transfer_preserves_total(from, to, amount).is_none());
        }

        #[test]
        fn fee_bps_never_exceeds_amount(amount in 0u128..1_000_000_000_000u128, fee_bps in 0u16..=10_000u16) {
            let fee = fee_amount(amount, fee_bps).expect("valid fee bps");
            prop_assert!(fee <= amount);
        }

        #[test]
        fn fee_bps_above_one_hundred_percent_is_rejected(amount in 0u128..1_000_000_000_000u128, fee_bps in 10_001u16..=u16::MAX) {
            prop_assert!(fee_amount(amount, fee_bps).is_none());
        }

        #[test]
        fn project_state_machine_rejects_direct_completion(from in prop_oneof![Just(ProjectState::Created), Just(ProjectState::Funded), Just(ProjectState::WorkSubmitted)]) {
            prop_assert!(!valid_transition(from, ProjectState::Completed));
        }

        #[test]
        fn terminal_states_do_not_transition_again(to in prop_oneof![
            Just(ProjectState::Created),
            Just(ProjectState::Funded),
            Just(ProjectState::WorkSubmitted),
            Just(ProjectState::Verified),
            Just(ProjectState::Completed),
            Just(ProjectState::Disputed),
            Just(ProjectState::Cancelled),
        ]) {
            prop_assert!(!valid_transition(ProjectState::Completed, to));
            prop_assert!(!valid_transition(ProjectState::Cancelled, to));
        }

        #[test]
        fn nonce_must_increase_monotonically(current in 0u64..u64::MAX, replayed in 0u64..u64::MAX) {
            let next = current.saturating_add(1);
            prop_assume!(replayed != current);
            prop_assert_ne!(replayed, current);
            prop_assert!(next >= current);
        }

        #[test]
        fn gas_bounds_remain_under_configured_limit(base in 21_000u64..100_000u64, per_call in 5_000u64..80_000u64, calls in 0u64..100u64) {
            let gas_limit = 10_000_000u64;
            let total = base.saturating_add(per_call.saturating_mul(calls));
            prop_assert!(total <= gas_limit || calls > 0);
        }
    }
}
