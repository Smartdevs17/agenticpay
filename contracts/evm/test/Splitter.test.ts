import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import type { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import type { SplitterV1 } from '../typechain-types';

const BPS_100_PCT = 10_000;

async function deploy(owner: string, feeBps: number): Promise<SplitterV1> {
  const factory = await ethers.getContractFactory('SplitterV1');
  const proxy = await upgrades.deployProxy(factory, [owner, feeBps], {
    kind: 'uups',
    initializer: 'initialize',
  });
  await proxy.waitForDeployment();
  return proxy as unknown as SplitterV1;
}

describe('SplitterV1', () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let payer: SignerWithAddress;
  let splitter: SplitterV1;

  beforeEach(async () => {
    [owner, alice, bob, payer] = await ethers.getSigners();
    splitter = await deploy(owner.address, 250); // 2.5% platform fee
  });

  describe('initialisation', () => {
    it('stores owner and initial platform fee', async () => {
      expect(await splitter.owner()).to.equal(owner.address);
      expect(await splitter.platformFeeBps()).to.equal(250);
    });

    it('rejects a fee above 100%', async () => {
      const factory = await ethers.getContractFactory('SplitterV1');
      await expect(
        upgrades.deployProxy(factory, [owner.address, BPS_100_PCT + 1], {
          kind: 'uups',
          initializer: 'initialize',
        }),
      ).to.be.revertedWithCustomError(splitter, 'InvalidFee');
    });

    it('rejects the zero-address owner', async () => {
      const factory = await ethers.getContractFactory('SplitterV1');
      await expect(
        upgrades.deployProxy(factory, [ethers.ZeroAddress, 100], {
          kind: 'uups',
          initializer: 'initialize',
        }),
      ).to.be.revertedWithCustomError(splitter, 'InvalidRecipient');
    });

    it('cannot be initialised a second time', async () => {
      await expect(
        splitter.initialize(owner.address, 100),
      ).to.be.revertedWithCustomError(splitter, 'InvalidInitialization');
    });
  });

  describe('recipient configuration', () => {
    it('appends and updates recipients in order', async () => {
      await splitter.connect(owner).setRecipient(0, alice.address, 6000, 0, true);
      await splitter.connect(owner).setRecipient(1, bob.address, 4000, 0, true);
      expect(await splitter.recipientsCount()).to.equal(2);

      await splitter.connect(owner).setRecipient(1, bob.address, 3000, 100, false);
      const updated = await splitter.recipients(1);
      expect(updated.bps).to.equal(3000);
      expect(updated.active).to.equal(false);
      expect(updated.minThreshold).to.equal(100);
    });

    it('rejects out-of-range indices', async () => {
      await expect(
        splitter.connect(owner).setRecipient(5, alice.address, 100, 0, true),
      ).to.be.revertedWithCustomError(splitter, 'InvalidIndex');
    });

    it('rejects a zero-address recipient', async () => {
      await expect(
        splitter.connect(owner).setRecipient(0, ethers.ZeroAddress, 100, 0, true),
      ).to.be.revertedWithCustomError(splitter, 'InvalidRecipient');
    });

    it('only lets the owner update configuration', async () => {
      await expect(
        splitter.connect(alice).setPlatformFeeBps(500),
      ).to.be.revertedWithCustomError(splitter, 'OwnableUnauthorizedAccount');
    });
  });

  describe('splitPayment', () => {
    beforeEach(async () => {
      await splitter.connect(owner).setRecipient(0, alice.address, 7000, 0, true);
      await splitter.connect(owner).setRecipient(1, bob.address, 3000, 0, true);
    });

    it('distributes the distributable amount by bps', async () => {
      const value = ethers.parseEther('1');
      const platformFee = (value * 250n) / 10_000n;
      const distributable = value - platformFee;
      const aliceShare = (distributable * 7000n) / 10_000n;
      const bobShare = (distributable * 3000n) / 10_000n;

      const aliceBefore = await ethers.provider.getBalance(alice.address);
      const bobBefore = await ethers.provider.getBalance(bob.address);

      await expect(splitter.connect(payer).splitPayment({ value }))
        .to.emit(splitter, 'PaymentSplit')
        .withArgs(value, platformFee, aliceShare + bobShare);

      expect(await ethers.provider.getBalance(alice.address)).to.equal(
        aliceBefore + aliceShare,
      );
      expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBefore + bobShare);

      // Platform fee stays in the contract until the owner withdraws it.
      expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(
        platformFee,
      );
    });

    it('skips inactive recipients and those under the min threshold', async () => {
      // Make bob inactive and give alice a threshold larger than her share.
      await splitter.connect(owner).setRecipient(0, alice.address, 7000, ethers.parseEther('10'), true);
      await splitter.connect(owner).setRecipient(1, bob.address, 3000, 0, false);

      const value = ethers.parseEther('1');
      const aliceBefore = await ethers.provider.getBalance(alice.address);
      const bobBefore = await ethers.provider.getBalance(bob.address);

      await splitter.connect(payer).splitPayment({ value });

      expect(await ethers.provider.getBalance(alice.address)).to.equal(aliceBefore);
      expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBefore);
    });

    it('reverts on a zero-value payment', async () => {
      await expect(
        splitter.connect(payer).splitPayment({ value: 0 }),
      ).to.be.revertedWithCustomError(splitter, 'NoPayment');
    });
  });

  describe('withdraw', () => {
    it('lets the owner withdraw accumulated fees', async () => {
      await splitter.connect(owner).setRecipient(0, alice.address, 10_000, 0, true);
      await splitter.connect(payer).splitPayment({ value: ethers.parseEther('1') });

      const withdrawTo = bob.address;
      const before = await ethers.provider.getBalance(withdrawTo);
      const contractBalance = await ethers.provider.getBalance(await splitter.getAddress());

      await splitter.connect(owner).withdraw(withdrawTo, contractBalance);
      expect(await ethers.provider.getBalance(withdrawTo)).to.equal(before + contractBalance);
      expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0);
    });

    it('rejects a withdrawal larger than the balance', async () => {
      await expect(
        splitter.connect(owner).withdraw(bob.address, ethers.parseEther('1')),
      ).to.be.revertedWithCustomError(splitter, 'InsufficientBalance');
    });

    it('is owner-gated', async () => {
      await expect(
        splitter.connect(alice).withdraw(alice.address, 1),
      ).to.be.revertedWithCustomError(splitter, 'OwnableUnauthorizedAccount');
    });
  });
});
