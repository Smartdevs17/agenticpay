/**
 * Build an `upgradeToAndCall` transaction for the current proxy and emit
 * the calldata + to-be-submitted JSON for a Gnosis Safe / OpenZeppelin
 * Defender multisig.
 *
 * This script does NOT execute anything on-chain. It compiles the new
 * implementation, validates the upgrade against the existing proxy, and
 * prints everything the safe signers need:
 *   - the predicted new implementation address
 *   - the `upgradeToAndCall` calldata for the proxy
 *   - a JSON payload matching the Safe Transaction Service format
 *
 * Usage:
 *   npx hardhat run --network <name> scripts/propose-safe-upgrade.ts
 *
 * Env:
 *   SPLITTER_CONTRACT   new implementation (default SplitterV2)
 *   SPLITTER_CALL       optional post-upgrade call (e.g. "initializeV2")
 *   SAFE_ADDRESS        Safe multisig that owns the proxy (required)
 */
import hre from 'hardhat';
import { readDeployment } from './lib/deployment-store';
import { assertPersistentNetwork, resolveNetwork } from './lib/network';

async function main(): Promise<void> {
  const { ethers, upgrades } = hre;
  const { name: network, chainId } = await resolveNetwork();
  assertPersistentNetwork(network);

  const deployment = readDeployment(network);
  if (!deployment) {
    throw new Error(`No deployment record for "${network}".`);
  }

  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) {
    throw new Error('SAFE_ADDRESS is required. Set it to the Safe that owns the proxy.');
  }

  const newContract = process.env.SPLITTER_CONTRACT ?? 'SplitterV2';
  const postCall = process.env.SPLITTER_CALL;
  const newFactory = await ethers.getContractFactory(newContract);

  await upgrades.validateUpgrade(deployment.proxy, newFactory, { kind: 'uups' });
  const newImpl = await upgrades.prepareUpgrade(deployment.proxy, newFactory, {
    kind: 'uups',
  });

  const call = postCall
    ? newFactory.interface.encodeFunctionData(postCall)
    : '0x';

  // UUPS proxies expose `upgradeToAndCall(address,bytes)` directly (the
  // selector lives on the implementation, which is OK — the proxy
  // delegates). Constructing calldata manually keeps this script free of
  // the proxy ABI import.
  const upgradeIface = new ethers.Interface([
    'function upgradeToAndCall(address newImplementation, bytes data) external payable',
  ]);
  const data = upgradeIface.encodeFunctionData('upgradeToAndCall', [newImpl, call]);

  console.log(`▶ upgrade proposal for ${deployment.proxy} on ${network}`);
  console.log(`  new implementation: ${newImpl}`);
  console.log(`  safe:               ${safeAddress}`);
  console.log();
  console.log('safe-transaction-service payload:');
  console.log(
    JSON.stringify(
      {
        safe: safeAddress,
        to: deployment.proxy,
        value: '0',
        data,
        operation: 0,
        chainId,
      },
      null,
      2,
    ),
  );
  console.log();
  console.log(
    'submit this via the Safe web UI (Tx Builder) or `safe-cli` / ' +
      '`@safe-global/protocol-kit`. Once executed, run ' +
      '`npm run list -- --network ' + network + '` to refresh local state.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
