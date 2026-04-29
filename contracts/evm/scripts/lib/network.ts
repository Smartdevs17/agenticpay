import hre from 'hardhat';

/**
 * Returns the current network's name + chainId as reported by the hardhat
 * runtime. Callers use this to key deployment files and Etherscan configs.
 */
export async function resolveNetwork(): Promise<{ name: string; chainId: number }> {
  const { ethers, network } = hre;
  const { chainId } = await ethers.provider.getNetwork();
  return { name: network.name, chainId: Number(chainId) };
}

/**
 * Guard helper — refuses to run on the in-process `hardhat` network for
 * operational scripts (deploy/upgrade/verify). Tests are free to use it.
 */
export function assertPersistentNetwork(network: string): void {
  if (network === 'hardhat') {
    throw new Error(
      'Refusing to run against the in-process `hardhat` network. ' +
        'Pick a persistent network with `--network <name>` or start a ' +
        'local node via `npx hardhat node` and target `localhost`.',
    );
  }
}
