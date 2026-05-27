import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendRecord,
  deploymentFilePath,
  deploymentsRoot,
  latestRecord,
  listDeployments,
  readDeployment,
  writeDeployment,
} from '../scripts/lib/deployment-store';

describe('deployment-store', () => {
  let tmpDir: string;
  let originalRoot: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticpay-deploy-'));
    originalRoot = process.env.AGENTICPAY_DEPLOYMENTS_DIR;
    process.env.AGENTICPAY_DEPLOYMENTS_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalRoot === undefined) delete process.env.AGENTICPAY_DEPLOYMENTS_DIR;
    else process.env.AGENTICPAY_DEPLOYMENTS_DIR = originalRoot;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves the configured root', () => {
    expect(deploymentsRoot()).to.equal(tmpDir);
    expect(deploymentFilePath('sepolia')).to.equal(path.join(tmpDir, 'sepolia.json'));
  });

  it('returns null for an unknown network', () => {
    expect(readDeployment('sepolia')).to.equal(null);
  });

  it('appends history entries and keeps the current pointer in sync', () => {
    const firstRecord = {
      timestamp: '2026-04-24T00:00:00.000Z',
      action: 'deploy' as const,
      version: '1.0.0',
      proxy: '0x0000000000000000000000000000000000001234',
      implementation: '0x000000000000000000000000000000000000aaaa',
      deployer: '0x00000000000000000000000000000000000000de',
      transactionHash: '0x01',
      contract: 'SplitterV1',
      chainId: 11155111,
    };

    let deployment = appendRecord(null, firstRecord, {
      network: 'sepolia',
      contract: 'SplitterV1',
    });
    writeDeployment(deployment);

    const upgradeRecord = {
      ...firstRecord,
      timestamp: '2026-04-24T01:00:00.000Z',
      action: 'upgrade' as const,
      version: '2.0.0',
      implementation: '0x000000000000000000000000000000000000bbbb',
      contract: 'SplitterV2',
      transactionHash: '0x02',
    };
    deployment = appendRecord(readDeployment('sepolia'), upgradeRecord, {
      network: 'sepolia',
      contract: 'SplitterV2',
    });
    writeDeployment(deployment);

    const loaded = readDeployment('sepolia');
    expect(loaded?.history).to.have.length(2);
    expect(loaded?.currentImplementation).to.equal(upgradeRecord.implementation);
    expect(loaded?.currentVersion).to.equal('2.0.0');
    expect(loaded?.contract).to.equal('SplitterV2');
  });

  it('finds the latest record of a given action', () => {
    const base = {
      timestamp: '2026-04-24T00:00:00.000Z',
      proxy: '0xp',
      deployer: '0xd',
      contract: 'SplitterV1',
      chainId: 1,
    };
    let deployment = appendRecord(
      null,
      {
        ...base,
        action: 'deploy',
        version: '1.0.0',
        implementation: '0xa',
        transactionHash: '0x1',
      },
      { network: 'mainnet', contract: 'SplitterV1' },
    );
    deployment = appendRecord(
      deployment,
      {
        ...base,
        action: 'upgrade',
        version: '2.0.0',
        implementation: '0xb',
        transactionHash: '0x2',
        contract: 'SplitterV2',
      },
      { network: 'mainnet', contract: 'SplitterV2' },
    );
    deployment = appendRecord(
      deployment,
      {
        ...base,
        action: 'rollback',
        version: '1.0.0',
        implementation: '0xa',
        transactionHash: '0x3',
      },
      { network: 'mainnet', contract: 'SplitterV1' },
    );

    expect(latestRecord(deployment)?.action).to.equal('rollback');
    expect(latestRecord(deployment, 'upgrade')?.implementation).to.equal('0xb');
    expect(latestRecord(deployment, 'deploy')?.implementation).to.equal('0xa');
  });

  it('lists deployments across networks', () => {
    const record = {
      timestamp: '2026-04-24T00:00:00.000Z',
      action: 'deploy' as const,
      version: '1.0.0',
      proxy: '0x0000000000000000000000000000000000001234',
      implementation: '0x000000000000000000000000000000000000aaaa',
      deployer: '0x00000000000000000000000000000000000000de',
      contract: 'SplitterV1',
      chainId: 1,
    };

    writeDeployment(
      appendRecord(null, { ...record, chainId: 1 }, { network: 'mainnet', contract: 'SplitterV1' }),
    );
    writeDeployment(
      appendRecord(
        null,
        { ...record, chainId: 11155111 },
        { network: 'sepolia', contract: 'SplitterV1' },
      ),
    );

    const all = listDeployments();
    const names = all.map((d) => d.network).sort();
    expect(names).to.deep.equal(['mainnet', 'sepolia']);
  });
});
