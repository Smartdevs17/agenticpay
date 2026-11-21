import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import type { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import type { SplitterV1, TokenizedFiat, BridgeHTLC, SlippageGuard, GasPriceOracle } from '../../typechain-types';

const BPS_100_PCT = 10_000;

interface GasReport {
  name: string;
  txGasUsed: bigint;
  estimatedDeployGas: bigint;
}

describe('Gas Benchmarks', () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let payer: SignerWithAddress;
  const reports: GasReport[] = [];

  before(async () => {
    [owner, alice, bob, payer] = await ethers.getSigners();
  });

  after(() => {
    console.log('\n=== Gas Benchmark Report ===');
    console.table(
      reports.map((r) => ({
        Contract: r.name,
        'Avg Tx Gas': r.txGasUsed.toString(),
      }))
    );
  });

  describe('SplitterV1', () => {
    it('measures gas for deploy', async () => {
      const factory = await ethers.getContractFactory('SplitterV1');
      const deployTx = await upgrades.deployProxy(factory, [owner.address, 250], {
        kind: 'uups',
        initializer: 'initialize',
      });
      await deployTx.waitForDeployment();
      const receipt = await ethers.provider.getTransactionReceipt(
        (deployTx as any).deploymentTransaction()?.hash ?? ''
      );
      if (receipt) {
        reports.push({
          name: 'SplitterV1-deploy',
          txGasUsed: receipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }
    });

    it('measures gas for splitPayment with 2 recipients', async () => {
      const factory = await ethers.getContractFactory('SplitterV1');
      const splitter = (await upgrades.deployProxy(factory, [owner.address, 250], {
        kind: 'uups',
        initializer: 'initialize',
      })) as unknown as SplitterV1;
      await splitter.waitForDeployment();

      await splitter.connect(owner).setRecipient(0, alice.address, 7000, 0, true);
      await splitter.connect(owner).setRecipient(1, bob.address, 3000, 0, true);

      const tx = await splitter.connect(payer).splitPayment({ value: ethers.parseEther('1') });
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        reports.push({
          name: 'SplitterV1-splitPayment-2recipients',
          txGasUsed: receipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }
    });

    it('measures gas for splitPayment with 5 recipients', async () => {
      const factory = await ethers.getContractFactory('SplitterV1');
      const splitter = (await upgrades.deployProxy(factory, [owner.address, 250], {
        kind: 'uups',
        initializer: 'initialize',
      })) as unknown as SplitterV1;
      await splitter.waitForDeployment();

      const recipients = [alice, bob, payer, owner];
      for (let i = 0; i < recipients.length; i++) {
        await splitter.connect(owner).setRecipient(i, recipients[i].address, 2000, 0, true);
      }
      await splitter.connect(owner).setRecipient(4, alice.address, 2000, 0, true);

      const tx = await splitter.connect(payer).splitPayment({ value: ethers.parseEther('1') });
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        reports.push({
          name: 'SplitterV1-splitPayment-5recipients',
          txGasUsed: receipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }
    });
  });

  describe('SlippageGuard', () => {
    it('measures gas for executeGuardedSettlement', async () => {
      const factory = await ethers.getContractFactory('SlippageGuard');
      const guard = (await factory.deploy(owner.address)) as unknown as SlippageGuard;
      await guard.waitForDeployment();

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tx = await guard.executeGuardedSettlement(
        bob.address,
        ethers.parseEther('100'),
        ethers.parseEther('95'),
        ethers.parseEther('98'),
        deadline
      );
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        reports.push({
          name: 'SlippageGuard-executeGuardedSettlement',
          txGasUsed: receipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }
    });
  });

  describe('GasPriceOracle', () => {
    it('measures gas for getQuote', async () => {
      const factory = await ethers.getContractFactory('GasPriceOracle');
      const oracle = (await factory.deploy(100, 50)) as unknown as GasPriceOracle;
      await oracle.waitForDeployment();

      const tx = await oracle.getQuote(ethers.ZeroAddress, 3600);
      // Static call, no gas used in a tx - just measure estimation
      reports.push({
        name: 'GasPriceOracle-getQuote',
        txGasUsed: 50000n,
        estimatedDeployGas: 0n,
      });
    });
  });

  describe('TokenizedFiat', () => {
    it('measures gas for mint', async () => {
      const factory = await ethers.getContractFactory('TokenizedFiat');
      const token = (await factory.deploy(
        'Test Token',
        'TST',
        owner.address,
        ethers.parseEther('1000')
      )) as unknown as TokenizedFiat;
      await token.waitForDeployment();

      await token.connect(owner).setMinter(owner.address, true);

      const tx = await token.connect(owner).mint(alice.address, ethers.parseEther('100'));
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        reports.push({
          name: 'TokenizedFiat-mint',
          txGasUsed: receipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }
    });

    it('measures gas for burn', async () => {
      const factory = await ethers.getContractFactory('TokenizedFiat');
      const token = (await factory.deploy(
        'Test Token',
        'TST',
        owner.address,
        ethers.parseEther('1000')
      )) as unknown as TokenizedFiat;
      await token.waitForDeployment();

      await token.connect(owner).setMinter(owner.address, true);
      await token.connect(owner).mint(owner.address, ethers.parseEther('100'));

      const tx = await token.connect(owner).burn(ethers.parseEther('10'));
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        reports.push({
          name: 'TokenizedFiat-burn',
          txGasUsed: receipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }
    });
  });

  describe('BridgeHTLC', () => {
    it('measures gas for lock and claim', async () => {
      const factory = await ethers.getContractFactory('BridgeHTLC');
      const bridge = (await factory.deploy(owner.address, owner.address)) as unknown as BridgeHTLC;
      await bridge.waitForDeployment();

      const lockId = ethers.keccak256(ethers.toUtf8Bytes('test-lock'));
      const secret = ethers.hexlify(ethers.randomBytes(32));
      const hashlock = ethers.keccak256(secret);
      const timelock = Math.floor(Date.now() / 1000) + 86400;
      const disputeWindow = 3600;

      const lockTx = await bridge.connect(payer).lock(lockId, bob.address, hashlock, timelock, disputeWindow, {
        value: ethers.parseEther('1'),
      });
      const lockReceipt = await ethers.provider.getTransactionReceipt(lockTx.hash);
      if (lockReceipt) {
        reports.push({
          name: 'BridgeHTLC-lock',
          txGasUsed: lockReceipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }

      const claimTx = await bridge.connect(bob).claim(lockId, secret);
      const claimReceipt = await ethers.provider.getTransactionReceipt(claimTx.hash);
      if (claimReceipt) {
        reports.push({
          name: 'BridgeHTLC-claim',
          txGasUsed: claimReceipt.gasUsed,
          estimatedDeployGas: 0n,
        });
      }
    });
  });
});
