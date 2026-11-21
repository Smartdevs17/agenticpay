/**
 * Upgrade the live proxy to a new implementation.
 *
 * Usage:
 *   npx hardhat run --network <name> scripts/upgrade.ts
 *
 * Env:
 *   SPLITTER_CONTRACT   new implementation contract name (default: SplitterV2)
 *   SPLITTER_CALL       optional initializer call to run after the upgrade,
 *                       encoded as `methodName` (no-arg) or left unset to skip.
 *   PROPOSE_ONLY        when "true", just prepares + prints the new impl
 *                       address (so a Safe / multisig can execute the
 *                       `upgradeToAndCall`). Nothing on-chain is changed
 *                       beyond deploying the implementation contract.
 *   TIMELOCK_ADDRESS    when set, uses the TimelockController governance flow:
 *                       schedules an upgrade proposal and waits for approvals
 *                       and timelock delay before executing.
 *   TIMELOCK_EXECUTE    when "true" and TIMELOCK_ADDRESS is set, executes a
 *                       previously scheduled and approved proposal after the delay.
 *   PROPOSAL_ID         the proposal ID to approve or execute (for timelock flow).
 */
import hre from 'hardhat';
import {
  appendRecord,
  readDeployment,
  writeDeployment,
} from './lib/deployment-store';
import { assertPersistentNetwork, resolveNetwork } from './lib/network';

async function main(): Promise<void> {
  const { ethers, upgrades } = hre;
  const { name: network, chainId } = await resolveNetwork();
  assertPersistentNetwork(network);

  const existing = readDeployment(network);
  if (!existing) {
    throw new Error(
      `No deployment record for "${network}". Run scripts/deploy.ts first.`,
    );
  }

  const contractName = process.env.SPLITTER_CONTRACT ?? 'SplitterV2';
  const proposeOnly = process.env.PROPOSE_ONLY === 'true';
  const callFn = process.env.SPLITTER_CALL;

  // Route to timelock flow if TIMELOCK_ADDRESS is set
  if (process.env.TIMELOCK_ADDRESS) {
    await timelockUpgrade();
    return;
  }

  const [deployer] = await ethers.getSigners();
  console.log(`▶ upgrading ${existing.contract} → ${contractName} on ${network}`);
  console.log(`  proxy:    ${existing.proxy}`);
  console.log(`  deployer: ${await deployer.getAddress()}`);

  const newFactory = await ethers.getContractFactory(contractName);

  // Always run the OZ validator first. This catches storage-layout and
  // upgrade-safety issues before either path touches the network.
  await upgrades.validateUpgrade(existing.proxy, newFactory, { kind: 'uups' });

  if (proposeOnly) {
    const implementation = await upgrades.prepareUpgrade(existing.proxy, newFactory, {
      kind: 'uups',
    });
    console.log('✔ prepared (nothing upgraded yet)');
    console.log(`  new implementation: ${implementation}`);
    console.log(
      '  hand this to scripts/propose-safe-upgrade.ts or any multisig tooling.',
    );
    return;
  }

  const upgradeOptions: Record<string, unknown> = { kind: 'uups' };
  if (callFn) {
    upgradeOptions.call = callFn;
  }

  const proxy = await upgrades.upgradeProxy(existing.proxy, newFactory, upgradeOptions);
  await proxy.waitForDeployment();

  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    existing.proxy,
  );
  const version = (await (proxy as unknown as { version: () => Promise<string> }).version()) as string;
  const upgradeTx = proxy.deploymentTransaction();

  const record = {
    timestamp: new Date().toISOString(),
    action: 'upgrade' as const,
    version,
    proxy: existing.proxy,
    implementation: implementationAddress,
    deployer: await deployer.getAddress(),
    transactionHash: upgradeTx?.hash,
    contract: contractName,
    chainId,
  };

  const file = writeDeployment(
    appendRecord(existing, record, { network, contract: contractName }),
  );

  console.log('✔ upgraded');
  console.log(`  new implementation: ${implementationAddress}`);
  console.log(`  new version:        ${version}`);
  console.log(`  recorded:           ${file}`);
}

/**
 * Timelock governance flow:
 * - Deploy implementation
 * - Schedule proposal on TimelockController
 * - Approve with required threshold
 * - Wait for timelock delay
 * - Execute upgrade
 */
async function timelockUpgrade(): Promise<void> {
  const { ethers, upgrades } = hre;
  const { name: network, chainId } = await resolveNetwork();
  assertPersistentNetwork(network);

  const existing = readDeployment(network);
  if (!existing) {
    throw new Error(`No deployment record for "${network}".`);
  }

  const timelockAddress = process.env.TIMELOCK_ADDRESS!;
  const contractName = process.env.SPLITTER_CONTRACT ?? 'SplitterV2';
  const [deployer] = await ethers.getSigners();

  console.log(`▶ timelock upgrade ${existing.contract} → ${contractName} on ${network}`);
  console.log(`  proxy:    ${existing.proxy}`);
  console.log(`  timelock: ${timelockAddress}`);
  console.log(`  deployer: ${await deployer.getAddress()}`);

  // 1. Deploy new implementation
  const newFactory = await ethers.getContractFactory(contractName);
  await upgrades.validateUpgrade(existing.proxy, newFactory, { kind: 'uups' });

  const impl = await newFactory.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log(`✔ new implementation deployed: ${implAddress}`);

  const timelock = await ethers.getContractAt('TimelockController', timelockAddress);

  // 2. Check if we need to execute a previously scheduled proposal
  if (process.env.TIMELOCK_EXECUTE === 'true') {
    const proposalId = parseInt(process.env.PROPOSAL_ID ?? '0');
    const proposal = await timelock.getProposal(proposalId);
    const isReady = await timelock.isReady(proposalId);

    if (!isReady) {
      const eta = Number(proposal.eta);
      const now = Math.floor(Date.now() / 1000);
      const remaining = eta - now;
      if (remaining > 0) {
        console.log(`⚠ Proposal ${proposalId} not ready. ${remaining}s remaining.`);
        return;
      }
      console.log(`⚠ Proposal ${proposalId} has insufficient approvals (${proposal.approvalCount}/${await timelock.approvalThreshold()})`);
      return;
    }

    const tx = await timelock.execute(proposalId);
    const receipt = await tx.wait();
    console.log(`✔ proposal ${proposalId} executed (tx: ${receipt?.hash})`);
    return;
  }

  // 3. Schedule the upgrade proposal
  const tx = await timelock.schedule(existing.proxy, implAddress, '0x');
  const receipt = await tx.wait();
  console.log(`✔ proposal scheduled (tx: ${receipt?.hash})`);

  // Parse proposal ID from event logs
  const filter = timelock.filters.ProposalScheduled();
  const events = await timelock.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  if (events.length > 0) {
    const proposalId = events[0].args[0];
    const delay = await timelock.delay();
    console.log(`  proposal ID: ${proposalId}`);
    console.log(`  timelock delay: ${delay.toString()}s`);
    console.log(`  ETA: ${new Date(Date.now() + Number(delay) * 1000).toISOString()}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Get ${await timelock.approvalThreshold()} approvers to call approve(${proposalId})`);
    console.log(`  2. Wait for timelock delay to pass`);
    console.log(`  3. Run: TIMELOCK_ADDRESS=${timelockAddress} TIMELOCK_EXECUTE=true PROPOSAL_ID=${proposalId} npx hardhat run --network ${network} scripts/upgrade.ts`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
