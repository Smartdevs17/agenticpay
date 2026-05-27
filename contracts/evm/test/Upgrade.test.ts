import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import type { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import type { SplitterV1, SplitterV2 } from '../typechain-types';

describe('Upgrade path: SplitterV1 → SplitterV2', () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let attacker: SignerWithAddress;
  let proxy: SplitterV1;

  beforeEach(async () => {
    [owner, alice, attacker] = await ethers.getSigners();

    const v1 = await ethers.getContractFactory('SplitterV1');
    proxy = (await upgrades.deployProxy(v1, [owner.address, 250], {
      kind: 'uups',
      initializer: 'initialize',
    })) as unknown as SplitterV1;
    await proxy.waitForDeployment();

    // Populate state so the upgrade has something to preserve.
    await proxy.connect(owner).setRecipient(0, alice.address, 10_000, 0, true);
  });

  it('preserves V1 state after upgrading to V2', async () => {
    const v2 = await ethers.getContractFactory('SplitterV2');
    const upgraded = (await upgrades.upgradeProxy(await proxy.getAddress(), v2, {
      kind: 'uups',
      call: 'initializeV2',
    })) as unknown as SplitterV2;

    expect(await upgraded.owner()).to.equal(owner.address);
    expect(await upgraded.platformFeeBps()).to.equal(250);
    expect(await upgraded.recipientsCount()).to.equal(1);

    const recipient = await upgraded.recipients(0);
    expect(recipient.wallet).to.equal(alice.address);
    expect(recipient.bps).to.equal(10_000);

    // New V2 state is initialised correctly.
    expect(await upgraded.paused()).to.equal(false);
    expect(await upgraded.version()).to.equal('2.0.0');
  });

  it('gates upgrades behind the owner', async () => {
    const v2 = await ethers.getContractFactory('SplitterV2', attacker);
    await expect(
      upgrades.upgradeProxy(await proxy.getAddress(), v2, { kind: 'uups' }),
    ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
  });

  it('rejects an upgrade that would corrupt storage layout', async () => {
    const bad = await ethers.getContractFactory('BadSplitterV2');
    // `validateUpgrade` is the guard that protects against layout drift —
    // OpenZeppelin throws before sending any transaction.
    await expect(
      upgrades.validateUpgrade(await proxy.getAddress(), bad, { kind: 'uups' }),
    ).to.be.rejectedWith(/New storage layout is incompatible|Deleted|replaced/i);
  });

  it('applies the V2 pause switch to splitPayment', async () => {
    const v2 = await ethers.getContractFactory('SplitterV2');
    const upgraded = (await upgrades.upgradeProxy(await proxy.getAddress(), v2, {
      kind: 'uups',
      call: 'initializeV2',
    })) as unknown as SplitterV2;

    await upgraded.connect(owner).setPaused(true);
    await expect(
      upgraded.connect(owner).splitPayment({ value: ethers.parseEther('1') }),
    ).to.be.revertedWithCustomError(upgraded, 'ContractPaused');

    await upgraded.connect(owner).setPaused(false);
    await expect(
      upgraded.connect(owner).splitPayment({ value: ethers.parseEther('1') }),
    ).to.emit(upgraded, 'PaymentSplit');
  });

  it('supports manual rollback by re-upgrading to a prior implementation', async () => {
    const proxyAddress = await proxy.getAddress();
    const v1Impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    const v2 = await ethers.getContractFactory('SplitterV2');
    await upgrades.upgradeProxy(proxyAddress, v2, {
      kind: 'uups',
      call: 'initializeV2',
    });

    // Re-pointing the proxy at the V1 implementation is the rollback
    // primitive — the scripts/rollback.ts CLI does exactly this via the
    // proxy's `upgradeToAndCall` entrypoint.
    const proxyIface = new ethers.Interface([
      'function upgradeToAndCall(address newImplementation, bytes data) external payable',
    ]);
    const data = proxyIface.encodeFunctionData('upgradeToAndCall', [v1Impl, '0x']);
    await owner.sendTransaction({ to: proxyAddress, data });

    const rolledBack = (await ethers.getContractAt(
      'SplitterV1',
      proxyAddress,
    )) as unknown as SplitterV1;

    expect(await rolledBack.version()).to.equal('1.0.0');
    expect(await rolledBack.recipientsCount()).to.equal(1);
  });
});
