/**
 * Roll a proxy back to a previous implementation recorded in the local
 * deployment history. Useful as an emergency lever when a fresh upgrade
 * behaves badly on mainnet.
 *
 * Usage:
 *   npx hardhat run --network <name> scripts/rollback.ts
 *
 * Env:
 *   ROLLBACK_TARGET   'previous' (default) | 'initial' | a history index (0-based)
 *                     | a specific implementation address (case-insensitive)
 */
import hre from 'hardhat';
import { appendRecord, readDeployment, writeDeployment } from './lib/deployment-store';
import { assertPersistentNetwork, resolveNetwork } from './lib/network';

async function main(): Promise<void> {
  const { ethers } = hre;
  const { name: network, chainId } = await resolveNetwork();
  assertPersistentNetwork(network);

  const deployment = readDeployment(network);
  if (!deployment) {
    throw new Error(`No deployment record for "${network}".`);
  }
  if (deployment.history.length < 2) {
    throw new Error(
      'Only one entry in history — nothing to roll back to. Deploy a new implementation before testing rollback.',
    );
  }

  const target = (process.env.ROLLBACK_TARGET ?? 'previous').trim();
  const current = deployment.history.at(-1)!;
  const history = deployment.history;

  let targetEntry: (typeof history)[number] | undefined;
  if (target === 'previous') {
    targetEntry = history[history.length - 2];
  } else if (target === 'initial') {
    targetEntry = history[0];
  } else if (/^\d+$/.test(target)) {
    const idx = Number(target);
    targetEntry = history[idx];
    if (!targetEntry) throw new Error(`History index ${idx} out of range`);
  } else if (/^0x[0-9a-f]{40}$/i.test(target)) {
    targetEntry = [...history].reverse().find(
      (h) => h.implementation.toLowerCase() === target.toLowerCase(),
    );
    if (!targetEntry) throw new Error(`No history entry for implementation ${target}`);
  } else {
    throw new Error(`Unrecognised ROLLBACK_TARGET "${target}"`);
  }

  if (targetEntry.implementation.toLowerCase() === current.implementation.toLowerCase()) {
    throw new Error('Target implementation matches the current one — nothing to do.');
  }

  const [deployer] = await ethers.getSigners();
  console.log(`▶ rolling back ${deployment.proxy} on ${network}`);
  console.log(`  from: ${current.implementation} (${current.version})`);
  console.log(`  to:   ${targetEntry.implementation} (${targetEntry.version})`);

  // UUPS proxies expose `upgradeToAndCall` on the current implementation.
  // We deliberately call it with `data = 0x` because the target impl is
  // already initialised — re-running its initializer would revert or
  // worse, re-set state.
  const proxyIface = new ethers.Interface([
    'function upgradeToAndCall(address newImplementation, bytes data) external payable',
  ]);
  const data = proxyIface.encodeFunctionData('upgradeToAndCall', [
    targetEntry.implementation,
    '0x',
  ]);

  const tx = await deployer.sendTransaction({ to: deployment.proxy, data });
  const receipt = await tx.wait();
  console.log(`  tx: ${receipt?.hash}`);

  const record = {
    timestamp: new Date().toISOString(),
    action: 'rollback' as const,
    version: targetEntry.version,
    proxy: deployment.proxy,
    implementation: targetEntry.implementation,
    deployer: await deployer.getAddress(),
    transactionHash: receipt?.hash,
    contract: targetEntry.contract,
    chainId,
    notes: `rolled back from ${current.implementation}`,
  };

  const file = writeDeployment(
    appendRecord(deployment, record, { network, contract: targetEntry.contract }),
  );
  console.log(`✔ rollback complete — recorded ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
