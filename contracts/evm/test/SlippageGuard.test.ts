import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import type { SlippageGuard } from '../typechain-types';

async function deploy(owner: string): Promise<SlippageGuard> {
  const factory = await ethers.getContractFactory('SlippageGuard');
  const contract = await factory.deploy(owner);
  await contract.waitForDeployment();
  return contract as unknown as SlippageGuard;
}

describe('SlippageGuard', () => {
  let owner: SignerWithAddress;
  let recipient: SignerWithAddress;
  let guard: SlippageGuard;

  beforeEach(async () => {
    [owner, recipient] = await ethers.getSigners();
    guard = await deploy(owner.address);
  });

  describe('configuration', () => {
    it('starts with a 1% default tolerance and 5% hard cap', async () => {
      expect(await guard.defaultMaxSlippageBps()).to.equal(100);
      expect(await guard.MAX_SLIPPAGE_BPS()).to.equal(500);
    });

    it('allows the owner to lower the default tolerance', async () => {
      await guard.setDefaultMaxSlippageBps(50);
      expect(await guard.defaultMaxSlippageBps()).to.equal(50);
    });

    it('rejects a default tolerance above the hard cap', async () => {
      await expect(guard.setDefaultMaxSlippageBps(501)).to.be.revertedWithCustomError(
        guard,
        'SlippageToleranceTooHigh'
      );
    });

    it('rejects configuration changes from non-owners', async () => {
      await expect(guard.connect(recipient).setDefaultMaxSlippageBps(50)).to.be.reverted;
    });
  });

  describe('computeMinAmountOut', () => {
    it('applies the requested tolerance when within the hard cap', async () => {
      const min = await guard.computeMinAmountOut(1_000_000, 100); // 1%
      expect(min).to.equal(990_000);
    });

    it('clamps tolerance requests above the hard cap to MAX_SLIPPAGE_BPS', async () => {
      const min = await guard.computeMinAmountOut(1_000_000, 10_000); // requests 100%
      expect(min).to.equal(950_000); // clamped to 5%
    });
  });

  describe('checkSlippage', () => {
    it('passes when actual output meets the floor', async () => {
      await expect(guard.checkSlippage(990_000, 990_000)).to.not.be.reverted;
    });

    it('reverts when actual output falls below the floor (sandwich-attack outcome)', async () => {
      await expect(guard.checkSlippage(980_000, 990_000)).to.be.revertedWithCustomError(guard, 'SlippageExceeded');
    });
  });

  describe('executeGuardedSettlement', () => {
    it('emits an event and succeeds when output is within tolerance and quote is fresh', async () => {
      const deadline = (await ethers.provider.getBlock('latest'))!.timestamp + 600;
      await expect(
        guard.executeGuardedSettlement(recipient.address, 1_000_000, 990_000, 995_000, deadline)
      )
        .to.emit(guard, 'GuardedSettlementExecuted')
        .withArgs(owner.address, recipient.address, 1_000_000, 990_000, 995_000);
    });

    it('reverts when the realized output is below minAmountOut', async () => {
      const deadline = (await ethers.provider.getBlock('latest'))!.timestamp + 600;
      await expect(
        guard.executeGuardedSettlement(recipient.address, 1_000_000, 990_000, 980_000, deadline)
      ).to.be.revertedWithCustomError(guard, 'SlippageExceeded');
    });

    it('reverts when the quote has expired', async () => {
      const pastDeadline = (await ethers.provider.getBlock('latest'))!.timestamp - 1;
      await expect(
        guard.executeGuardedSettlement(recipient.address, 1_000_000, 990_000, 995_000, pastDeadline)
      ).to.be.revertedWithCustomError(guard, 'ExpiredQuote');
    });

    it('reverts on a zero expected or actual amount', async () => {
      const deadline = (await ethers.provider.getBlock('latest'))!.timestamp + 600;
      await expect(
        guard.executeGuardedSettlement(recipient.address, 0, 0, 995_000, deadline)
      ).to.be.revertedWithCustomError(guard, 'ZeroAmount');
    });
  });
});
