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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
