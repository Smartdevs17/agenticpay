/**
 * Deterministic (CREATE2) deployment of the UUPS implementation + proxy.
 *
 * Uses the well-known `ImmutableCreate2Factory` at
 * 0x0000000000FFe8B47B3e2130213B802212439497 (deployed on every major
 * EVM chain). Addresses are pinned by the combination of the factory,
 * the deploying EOA, the chosen salt and the contract bytecode — the
 * same inputs produce the same address on every network.
 *
 * Usage:
 *   npx hardhat run --network <name> scripts/deploy-create2.ts
 *
 * Env:
 *   SPLITTER_CONTRACT       default SplitterV1
 *   SPLITTER_OWNER          default = deployer
 *   SPLITTER_FEE_BPS        default 250
 *   CREATE2_SALT            default keccak256("agenticpay.splitter.v1")
 *   CREATE2_FACTORY_ADDRESS default 0x0000000000FFe8B47B3e2130213B802212439497
 */
import hre from 'hardhat';
import { appendRecord, readDeployment, writeDeployment } from './lib/deployment-store';
import { assertPersistentNetwork, resolveNetwork } from './lib/network';

const DEFAULT_FACTORY = '0x0000000000FFe8B47B3e2130213B802212439497';
const DEFAULT_SALT_SEED = 'agenticpay.splitter.v1';

const FACTORY_ABI = [
  'function safeCreate2(bytes32 salt, bytes initCode) external payable returns (address)',
  'function findCreate2Address(bytes32 salt, bytes initCode) external view returns (address)',
];

async function main(): Promise<void> {
  const { ethers } = hre;
  const { name: network, chainId } = await resolveNetwork();
  assertPersistentNetwork(network);

  if (readDeployment(network)) {
    throw new Error(
      `Deployment for "${network}" already exists. Use scripts/upgrade.ts instead.`,
    );
  }

  const contractName = process.env.SPLITTER_CONTRACT ?? 'SplitterV1';
  const factoryAddress = process.env.CREATE2_FACTORY_ADDRESS ?? DEFAULT_FACTORY;
  const saltSeed = process.env.CREATE2_SALT ?? DEFAULT_SALT_SEED;
  const salt = ethers.id(saltSeed);

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const owner = process.env.SPLITTER_OWNER ?? deployerAddress;
  const initialFeeBps = Number(process.env.SPLITTER_FEE_BPS ?? 250);

  // Check factory actually exists on the network — CREATE2 factories are
  // not deployed universally and attempting to call a missing one produces
  // a cryptic revert.
  const code = await ethers.provider.getCode(factoryAddress);
  if (code === '0x') {
    throw new Error(
      `CREATE2 factory not deployed at ${factoryAddress} on ${network}. ` +
        'Set CREATE2_FACTORY_ADDRESS to a factory that exists on this chain.',
    );
  }

  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer);

  console.log(`▶ CREATE2 deploying ${contractName} implementation`);
  console.log(`  factory: ${factoryAddress}`);
  console.log(`  salt:    ${salt} ("${saltSeed}")`);

  const implementationFactory = await ethers.getContractFactory(contractName);
  const implInitCode = implementationFactory.bytecode;
  const predictedImpl: string = await factory.findCreate2Address(salt, implInitCode);
  console.log(`  predicted impl: ${predictedImpl}`);

  const implTx = await factory.safeCreate2(salt, implInitCode);
  const implReceipt = await implTx.wait();
  console.log(`  ✔ implementation deployed (tx ${implReceipt?.hash})`);

  // Proxy is the ERC-1967 UUPS proxy from OpenZeppelin, with the
  // implementation address + initializer call baked into the constructor
  // args. Deploying via CREATE2 with the full initCode gives a
  // deterministic proxy address too.
  const proxyArtifact = await hre.artifacts.readArtifact('ERC1967Proxy');
  const initializerData = implementationFactory.interface.encodeFunctionData('initialize', [
    owner,
    initialFeeBps,
  ]);
  const proxyInitCode = ethers.concat([
    proxyArtifact.bytecode,
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes'],
      [predictedImpl, initializerData],
    ),
  ]);

  const proxySalt = ethers.id(`${saltSeed}.proxy`);
  const predictedProxy: string = await factory.findCreate2Address(proxySalt, proxyInitCode);
  console.log(`  predicted proxy: ${predictedProxy}`);

  const proxyTx = await factory.safeCreate2(proxySalt, proxyInitCode);
  const proxyReceipt = await proxyTx.wait();
  console.log(`  ✔ proxy deployed (tx ${proxyReceipt?.hash})`);

  // Sanity-check the proxy is wired to the predicted implementation.
  const live = implementationFactory.attach(predictedProxy);
  const version = (await (live as unknown as { version: () => Promise<string> }).version()) as string;

  const record = {
    timestamp: new Date().toISOString(),
    action: 'deploy' as const,
    version,
    proxy: predictedProxy,
    implementation: predictedImpl,
    deployer: deployerAddress,
    transactionHash: proxyReceipt?.hash,
    contract: contractName,
    chainId,
    notes: `CREATE2 factory=${factoryAddress} salt=${saltSeed}`,
  };

  const file = writeDeployment(
    appendRecord(null, record, { network, contract: contractName }),
  );
  console.log(`✔ deployment recorded: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
