#![no_std]

#[cfg(test)]
extern crate std;

/// Gas benchmarks for AgenticPay Soroban contracts.
///
/// Each benchmark measures the per-operation gas cost using
/// `env.cost_tracker()` and prints results for CI consumption.
/// Run with: `cargo test --features gas_benchmarks -- --nocapture`

#[cfg(test)]
mod benchmarks {
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::{vec, Address, BytesN, Env, String, Vec};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    struct BenchEnv {
        env: Env,
        contract_id: soroban_sdk::Address,
        admin: Address,
        client: Address,
        freelancer: Address,
    }

    impl BenchEnv {
        fn setup() -> Self {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register_contract(None, crate::AgenticPayContract);
            let admin = Address::generate(&env);
            let client = Address::generate(&env);
            let freelancer = Address::generate(&env);
            let client = crate::AgenticPayContractClient::new(&env, &contract_id);
            client.initialize(&admin);
            BenchEnv { env, contract_id, admin, client, freelancer }
        }

        fn with_env<F>(f: F) where F: FnOnce(&Self) {
            let ctx = Self::setup();
            f(&ctx);
        }

        fn print_gas(&self, label: &str, before: u64) {
            let after = self.env.cost_tracker().get_max();
            #[cfg(feature = "gas_benchmarks")]
            std::println!(
                "{}: {} (Δ{})",
                label,
                after,
                after.saturating_sub(before),
            );
            let _ = label;
            let _ = before;
        }

        fn track(&self) -> u64 {
            self.env.cost_tracker().get_max()
        }
    }

    // -----------------------------------------------------------------------
    // Project benchmarks
    // -----------------------------------------------------------------------

    #[test]
    fn bench_create_project() {
        BenchEnv::with_env(|ctx| {
            let before = ctx.track();
            let _id = ctx.client.create_project(
                &ctx.client,
                &ctx.freelancer,
                &1000,
                &String::from_str(&ctx.env, "Benchmark project"),
                &String::from_str(&ctx.env, "https://github.com/bench/repo"),
                &0,
            );
            ctx.print_gas("create_project", before);
        });
    }

    #[test]
    fn bench_fund_project() {
        BenchEnv::with_env(|ctx| {
            let id = ctx.client.create_project(
                &ctx.client,
                &ctx.freelancer,
                &1000,
                &String::from_str(&ctx.env, "P"),
                &String::from_str(&ctx.env, "https://github.com/r"),
                &0,
            );
            let before = ctx.track();
            ctx.client.fund_project(&id, &ctx.client, &1000);
            ctx.print_gas("fund_project", before);
        });
    }

    #[test]
    fn bench_approve_work() {
        BenchEnv::with_env(|ctx| {
            let id = ctx.client.create_project(
                &ctx.client,
                &ctx.freelancer,
                &1000,
                &String::from_str(&ctx.env, "P"),
                &String::from_str(&ctx.env, "https://github.com/r"),
                &0,
            );
            ctx.client.fund_project(&id, &ctx.client, &1000);
            ctx.client.submit_work(
                &id,
                &ctx.freelancer,
                &String::from_str(&ctx.env, "https://github.com/done"),
            );
            let before = ctx.track();
            ctx.client.approve_work(&id, &ctx.client);
            ctx.print_gas("approve_work", before);
        });
    }

    #[test]
    fn bench_batch_create_projects() {
        BenchEnv::with_env(|ctx| {
            let mut inputs = Vec::new(&ctx.env);
            for i in 0..10 {
                inputs.push_back(crate::ProjectInput {
                    freelancer: ctx.freelancer.clone(),
                    amount: (i + 1) * 100,
                    description: String::from_str(&ctx.env, "Batch"),
                    github_repo: String::from_str(&ctx.env, "https://github.com/b"),
                });
            }
            let before = ctx.track();
            let _ids = ctx.client.batch_create_projects(&ctx.client, &inputs);
            ctx.print_gas("batch_create_projects (10)", before);
        });
    }

    // -----------------------------------------------------------------------
    // Multisig benchmarks
    // -----------------------------------------------------------------------

    #[test]
    fn bench_create_multisig_wallet() {
        BenchEnv::with_env(|ctx| {
            let signers: Vec<Address> = (0..3)
                .map(|_| Address::generate(&ctx.env))
                .collect();
            let before = ctx.track();
            let _wallet_id = ctx.client.create_multisig_wallet(
                &ctx.client,
                &signers,
                &2,
                &0,
            );
            ctx.print_gas("create_multisig_wallet (3 signers)", before);
        });
    }

    #[test]
    fn bench_create_multisig_proposal() {
        BenchEnv::with_env(|ctx| {
            let signers: Vec<Address> = (0..3)
                .map(|_| Address::generate(&ctx.env))
                .collect();
            let wallet_id = ctx.client.create_multisig_wallet(
                &ctx.client,
                &signers,
                &2,
                &0,
            );
            let before = ctx.track();
            let _prop_id = ctx.client.create_multisig_proposal(
                &signers.get(0).unwrap(),
                &wallet_id,
                &500,
                &Address::generate(&ctx.env),
                &String::from_str(&ctx.env, "Test proposal"),
            );
            ctx.print_gas("create_multisig_proposal", before);
        });
    }

    // -----------------------------------------------------------------------
    // HTLC benchmarks
    // -----------------------------------------------------------------------

    #[test]
    fn bench_create_htlc_lock() {
        BenchEnv::with_env(|ctx| {
            ctx.client.init_bridge_config(&ctx.admin, &30, &ctx.admin);
            let secret: BytesN<32> = BytesN::from_array(&ctx.env, &[42u8; 32]);
            let hashlock = ctx.env.crypto().sha256(&secret);
            let before = ctx.track();
            let _lock_id = ctx.client.create_htlc_lock(
                &ctx.client,
                &crate::HtlcLockInput {
                    recipient: ctx.freelancer.clone(),
                    amount: 1000,
                    hashlock,
                    timelock: ctx.env.ledger().timestamp() + 1000,
                    dispute_window: 100,
                    target_chain: String::from_str(&ctx.env, "ethereum-mainnet"),
                    target_lock_id: String::from_str(&ctx.env, "0xabc"),
                },
            );
            ctx.print_gas("create_htlc_lock", before);
        });
    }

    #[test]
    fn bench_claim_htlc() {
        BenchEnv::with_env(|ctx| {
            ctx.client.init_bridge_config(&ctx.admin, &30, &ctx.admin);
            let secret: BytesN<32> = BytesN::from_array(&ctx.env, &[42u8; 32]);
            let hashlock = ctx.env.crypto().sha256(&secret);
            let lock_id = ctx.client.create_htlc_lock(
                &ctx.client,
                &crate::HtlcLockInput {
                    recipient: ctx.freelancer.clone(),
                    amount: 1000,
                    hashlock,
                    timelock: ctx.env.ledger().timestamp() + 1000,
                    dispute_window: 100,
                    target_chain: String::from_str(&ctx.env, "ethereum-mainnet"),
                    target_lock_id: String::from_str(&ctx.env, "0xabc"),
                },
            );
            let before = ctx.track();
            ctx.client.claim_htlc(&lock_id, &secret);
            ctx.print_gas("claim_htlc", before);
        });
    }

    #[test]
    fn bench_refund_htlc() {
        BenchEnv::with_env(|ctx| {
            ctx.client.init_bridge_config(&ctx.admin, &30, &ctx.admin);
            let secret: BytesN<32> = BytesN::from_array(&ctx.env, &[42u8; 32]);
            let hashlock = ctx.env.crypto().sha256(&secret);
            let timelock = ctx.env.ledger().timestamp() + 10;
            let lock_id = ctx.client.create_htlc_lock(
                &ctx.client,
                &crate::HtlcLockInput {
                    recipient: ctx.freelancer.clone(),
                    amount: 500,
                    hashlock,
                    timelock,
                    dispute_window: 5,
                    target_chain: String::from_str(&ctx.env, "ethereum-mainnet"),
                    target_lock_id: String::from_str(&ctx.env, "0xdef"),
                },
            );
            ctx.env.ledger().with_mut(|li| {
                li.timestamp = timelock + 1;
            });
            let before = ctx.track();
            ctx.client.refund_htlc(&lock_id);
            ctx.print_gas("refund_htlc", before);
        });
    }

    // -----------------------------------------------------------------------
    // Storage migration benchmark
    // -----------------------------------------------------------------------

    #[test]
    fn bench_migrate_storage() {
        BenchEnv::with_env(|ctx| {
            // Create 10 projects
            for i in 0..10 {
                ctx.client.create_project(
                    &ctx.client,
                    &ctx.freelancer,
                    &((i + 1) * 100),
                    &String::from_str(&ctx.env, "Pre-migration"),
                    &String::from_str(&ctx.env, "https://github.com/migrate"),
                    &0,
                );
            }
            let before = ctx.track();
            ctx.client.migrate_storage(&ctx.admin, &10);
            ctx.print_gas("migrate_storage (10 projects)", before);
        });
    }

    // -----------------------------------------------------------------------
    // Gas baseline assertions
    // -----------------------------------------------------------------------

    #[test]
    fn bench_gas_baseline_create_project() {
        BenchEnv::with_env(|ctx| {
            let before = ctx.track();
            let _id = ctx.client.create_project(
                &ctx.client,
                &ctx.freelancer,
                &1000,
                &String::from_str(&ctx.env, "P"),
                &String::from_str(&ctx.env, "https://github.com/r"),
                &0,
            );
            let after = ctx.track();
            let delta = after.saturating_sub(before);
            // Assert the gas cost is within a reasonable bound for Soroban.
            // This serves as a regression check — if a future change increases
            // the cost significantly, this assertion will catch it.
            assert!(
                delta < 1_000_000,
                "create_project gas cost ({}) exceeds 1,000,000 limit",
                delta
            );
            #[cfg(feature = "gas_benchmarks")]
            std::println!("create_project baseline: {}", delta);
        });
    }

    #[test]
    fn bench_gas_baseline_fund_and_approve() {
        BenchEnv::with_env(|ctx| {
            let id = ctx.client.create_project(
                &ctx.client,
                &ctx.freelancer,
                &1000,
                &String::from_str(&ctx.env, "P"),
                &String::from_str(&ctx.env, "https://github.com/r"),
                &0,
            );
            ctx.client.fund_project(&id, &ctx.client, &1000);
            ctx.client.submit_work(
                &id,
                &ctx.freelancer,
                &String::from_str(&ctx.env, "https://github.com/done"),
            );

            let before = ctx.track();
            ctx.client.approve_work(&id, &ctx.client);
            let delta = ctx.track().saturating_sub(before);
            assert!(
                delta < 1_000_000,
                "approve_work gas cost ({}) exceeds 1,000,000 limit",
                delta
            );
            #[cfg(feature = "gas_benchmarks")]
            std::println!("approve_work baseline: {}", delta);
        });
    }
}