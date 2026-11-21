import { describe, expect, it } from 'vitest';
import { getUpgradeValidatorService } from '../contracts/upgrade-validator.js';
import { evaluateMessage, getExpectedDeliveryMs } from '../bridge-monitor/alert-engine.js';
import { compressPayload } from '../archival/ipfs-uploader.js';

describe('UpgradeValidatorService', () => {
  const service = getUpgradeValidatorService();

  it('detects storage variable reordering', () => {
    const diffs = service.diffStorageLayout(
      [{ name: 'owner', type: 'address', slot: 0 }],
      [{ name: 'owner', type: 'address', slot: 1 }],
    );
    expect(diffs.some((d) => d.type === 'reorder')).toBe(true);
  });

  it('detects type changes', () => {
    const diffs = service.diffStorageLayout(
      [{ name: 'balance', type: 'uint256', slot: 0 }],
      [{ name: 'balance', type: 'uint128', slot: 0 }],
    );
    expect(diffs.some((d) => d.type === 'type_change')).toBe(true);
  });

  it('passes validation when layouts match on soroban', async () => {
    const result = await service.validateUpgrade({
      contractName: 'SplitterV2',
      platform: 'soroban',
      network: 'testnet',
      proxyAddress: 'GABC123',
      newImplementation: 'GDEF456',
      storageLayoutOld: [{ name: 'owner', type: 'address', slot: 0 }],
      storageLayoutNew: [{ name: 'owner', type: 'address', slot: 0 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.storageLayoutDiff).toHaveLength(0);
    }
  });
});

describe('Bridge alert engine', () => {
  it('evaluates delayed messages', () => {
    const threshold = getExpectedDeliveryMs('wormhole');
    const alerts = evaluateMessage({
      id: 'test',
      provider: 'wormhole',
      sourceChain: 'ethereum',
      destinationChain: 'stellar',
      messageId: 'msg-1',
      status: 'relayed',
      initiatedAt: new Date(Date.now() - threshold - 1000),
      expectedDeliveryMs: threshold,
    });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((a) => a.alertType === 'delivery_delayed')).toBe(true);
  });
});

describe('Archival compression', () => {
  it('compresses payload and produces a sha256 hash', async () => {
    const { buffer, hash, uncompressedBytes } = await compressPayload({
      test: 'data',
      items: [1, 2, 3],
    });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.length).toBeLessThan(uncompressedBytes);
    expect(hash).toHaveLength(64);
  });
});
