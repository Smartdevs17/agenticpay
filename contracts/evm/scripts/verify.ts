/**
 * Verify the current implementation + proxy on the active network's
 * block explorer. Re-reads the deployment file so it stays idempotent.
 *
 * Usage:
 *   npx hardhat run --network <name> scripts/verify.ts
 */
import hre from 'hardhat';
import { readDeployment } from './lib/deployment-store';
import { assertPersistentNetwork, resolveNetwork } from './lib/network';

async function safeVerify(address: string, args: unknown[]): Promise<void> {
  try {
    await hre.run('verify:verify', { address, constructorArguments: args });
    console.log(`  ✔ verified ${address}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log(`  ✔ ${address} already verified`);
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const { name: network } = await resolveNetwork();
  assertPersistentNetwork(network);

  const deployment = readDeployment(network);
  if (!deployment) {
    throw new Error(`No deployment record for "${network}".`);
  }

  console.log(`▶ verifying deployment on ${network}`);
  console.log(`  proxy:          ${deployment.proxy}`);
  console.log(`  implementation: ${deployment.currentImplementation}`);

  // The implementation has no constructor args (Initializable contracts
  // disable theirs). The UUPS proxy is deployed with empty data because
  // the initializer is invoked separately.
  await safeVerify(deployment.currentImplementation, []);
  await safeVerify(deployment.proxy, []);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
