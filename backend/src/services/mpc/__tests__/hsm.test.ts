import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryHsm, getHsm, resetHsm, setHsm } from '../hsm.js';
import type { Share } from '../types.js';

function makeShare(x: number, secret = Buffer.from('deadbeefcafebabe', 'hex')): Share {
  return { x, y: Buffer.from(secret) };
}

describe('InMemoryHsm', () => {
  let hsm: InMemoryHsm;

  beforeEach(() => {
    hsm = new InMemoryHsm();
  });

  it('stores, retrieves, and lists shares per key', async () => {
    await hsm.put('k1', 'n1', makeShare(1));
    await hsm.put('k1', 'n2', makeShare(2));
    await hsm.put('k2', 'n1', makeShare(3));

    expect(await hsm.get('k1', 'n1')).toBeDefined();
    expect((await hsm.listNodes('k1')).sort()).toEqual(['n1', 'n2']);
    expect(await hsm.listNodes('k2')).toEqual(['n1']);
  });

  it('returns cloned share buffers so stored state is immutable', async () => {
    const original = makeShare(1, Buffer.from('aa'.repeat(8), 'hex'));
    await hsm.put('k', 'n', original);
    original.y[0] = 0xff;

    const fetched = await hsm.get('k', 'n');
    expect(fetched?.y[0]).toBe(0xaa);
  });

  it('delete removes a single share without touching others', async () => {
    await hsm.put('k', 'n1', makeShare(1));
    await hsm.put('k', 'n2', makeShare(2));

    await hsm.delete('k', 'n1');
    expect(await hsm.get('k', 'n1')).toBeUndefined();
    expect(await hsm.get('k', 'n2')).toBeDefined();
  });

  it('deleteKey removes every share for a key', async () => {
    await hsm.put('k', 'n1', makeShare(1));
    await hsm.put('k', 'n2', makeShare(2));
    await hsm.put('other', 'n1', makeShare(1));

    await hsm.deleteKey('k');
    expect(await hsm.listNodes('k')).toEqual([]);
    expect(await hsm.listNodes('other')).toEqual(['n1']);
  });

  it('hides shares for nodes marked unavailable and surfaces them again', async () => {
    await hsm.put('k', 'n1', makeShare(1));
    hsm.setNodeAvailable('n1', false);

    expect(await hsm.isAvailable('n1')).toBe(false);
    expect(await hsm.get('k', 'n1')).toBeUndefined();

    hsm.setNodeAvailable('n1', true);
    expect(await hsm.get('k', 'n1')).toBeDefined();
  });

  it('module-level getHsm / setHsm swap the active backend', () => {
    const custom = new InMemoryHsm();
    setHsm(custom);
    expect(getHsm()).toBe(custom);
    resetHsm();
    expect(getHsm()).not.toBe(custom);
    expect(getHsm().name).toBe('in-memory');
  });
});
