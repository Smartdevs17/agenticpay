/**
 * Print a summary of every deployment this repo has recorded.
 *
 * Usage:
 *   npx hardhat run scripts/list-deployments.ts
 *   npx hardhat run --network <name> scripts/list-deployments.ts   # single
 */
import hre from 'hardhat';
import { listDeployments, readDeployment } from './lib/deployment-store';

function formatRow(action: string, version: string, timestamp: string, impl: string): string {
  return `  ${action.padEnd(8)} ${version.padEnd(10)} ${timestamp}  ${impl}`;
}

async function main(): Promise<void> {
  const single = hre.network.name !== 'hardhat' ? readDeployment(hre.network.name) : null;
  const deployments = single ? [single] : listDeployments();

  if (deployments.length === 0) {
    console.log('No deployments recorded yet.');
    return;
  }

  for (const d of deployments) {
    console.log(`▶ ${d.network} (chainId=${d.chainId})`);
    console.log(`  contract:          ${d.contract}`);
    console.log(`  proxy:             ${d.proxy}`);
    console.log(`  implementation:    ${d.currentImplementation}`);
    console.log(`  version:           ${d.currentVersion}`);
    console.log(`  history (${d.history.length}):`);
    for (const entry of d.history) {
      console.log(
        formatRow(entry.action, entry.version, entry.timestamp, entry.implementation),
      );
    }
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
