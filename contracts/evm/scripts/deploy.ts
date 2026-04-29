/**
 * Deploy the UUPS-upgradeable Splitter behind a proxy.
 *
 * Usage:
 *   npx hardhat run --network <name> scripts/deploy.ts
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY   signer key (required for non-local networks)
 *   SPLITTER_OWNER         initial owner; defaults to the deployer address
 *   SPLITTER_FEE_BPS       initial platform fee in basis points; defaults to 250
 *   SPLITTER_CONTRACT      implementation contract name; defaults to "SplitterV1"
 */
import hre from 'hardhat';
import { appendRecord, readDeployment, writeDeployment } from './lib/deployment-store';
import { assertPersistentNetwork, resolveNetwork } from './lib/network';

async function main(): Promise<void> {
  const { ethers, upgrades } = hre;
  const { name: network, chainId } = await resolveNetwork();
  assertPersistentNetwork(network);

  const existing = readDeployment(network);
  if (existing) {
    throw new Error(
      `Deployment for network "${network}" already exists at ${existing.proxy}. ` +
        'Use scripts/upgrade.ts to publish a new implementation.',
    );
  }

  const contractName = process.env.SPLITTER_CONTRACT ?? 'SplitterV1';
  const [deployer] = await ethers.getSigners();
  const owner = process.env.SPLITTER_OWNER ?? (await deployer.getAddress());
  const initialFeeBps = Number(process.env.SPLITTER_FEE_BPS ?? 250);

  console.log(`▶ deploying ${contractName} to ${network} (chainId=${chainId})`);
  console.log(`  deployer: ${await deployer.getAddress()}`);
  console.log(`  owner:    ${owner}`);
  console.log(`  fee bps:  ${initialFeeBps}`);

  const factory = await ethers.getContractFactory(contractName);
  const proxy = await upgrades.deployProxy(factory, [owner, initialFeeBps], {
    kind: 'uups',
    initializer: 'initialize',
  });
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const version = (await (proxy as unknown as { version: () => Promise<string> }).version()) as string;
  const deploymentTx = proxy.deploymentTransaction();

  const record = {
    timestamp: new Date().toISOString(),
    action: 'deploy' as const,
    version,
    proxy: proxyAddress,
    implementation: implementationAddress,
    deployer: await deployer.getAddress(),
    transactionHash: deploymentTx?.hash,
    contract: contractName,
    chainId,
  };

  const file = writeDeployment(
    appendRecord(null, record, { network, contract: contractName }),
  );

  console.log('✔ deployed');
  console.log(`  proxy:          ${proxyAddress}`);
  console.log(`  implementation: ${implementationAddress}`);
  console.log(`  version:        ${version}`);
  console.log(`  recorded:       ${file}`);
  console.log();
  console.log('next step: verify with `npm run verify:deployment -- --network', network + '`');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
