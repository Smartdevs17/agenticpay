import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaRepository } from '../implementations/PrismaRepository.js';
import { RedisRepository } from '../implementations/RedisRepository.js';
import type Redis from 'ioredis';

// ── PrismaRepository ──────────────────────────────────────────────────────────

interface Widget { id: string; name: string; value: number }

function makePrismaDelegate() {
  return {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe('PrismaRepository', () => {
  it('findById delegates to prisma.findUnique', async () => {
    const delegate = makePrismaDelegate();
    delegate.findUnique.mockResolvedValue({ id: '1', name: 'w', value: 42 });
    const repo = new PrismaRepository<Widget>(delegate);
    const result = await repo.findById('1');
    expect(result).toMatchObject({ id: '1', name: 'w' });
    expect(delegate.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('findMany passes where/skip/take', async () => {
    const delegate = makePrismaDelegate();
    delegate.findMany.mockResolvedValue([]);
    const repo = new PrismaRepository<Widget>(delegate);
    await repo.findMany({ where: { name: 'foo' }, limit: 10, offset: 5 });
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'foo' }, take: 10, skip: 5 }),
    );
  });

  it('create delegates to prisma.create', async () => {
    const delegate = makePrismaDelegate();
    const created = { id: '2', name: 'x', value: 1 };
    delegate.create.mockResolvedValue(created);
    const repo = new PrismaRepository<Widget>(delegate);
    const result = await repo.create({ name: 'x', value: 1 });
    expect(result).toEqual(created);
  });

  it('update returns null when prisma throws', async () => {
    const delegate = makePrismaDelegate();
    delegate.update.mockRejectedValue(new Error('not found'));
    const repo = new PrismaRepository<Widget>(delegate);
    const result = await repo.update('999', { name: 'y' });
    expect(result).toBeNull();
  });

  it('delete returns false when prisma throws', async () => {
    const delegate = makePrismaDelegate();
    delegate.delete.mockRejectedValue(new Error('not found'));
    const repo = new PrismaRepository<Widget>(delegate);
    expect(await repo.delete('999')).toBe(false);
  });
});

// ── RedisRepository ───────────────────────────────────────────────────────────

function makeRedisClient() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); }),
    del: vi.fn(async (k: string) => { const had = store.has(k); store.delete(k); return had ? 1 : 0; }),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace(':*', ':');
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    }),
    mget: vi.fn(async (...ks: string[]) => ks.map((k) => store.get(k) ?? null)),
  } as unknown as Redis;
}

describe('RedisRepository', () => {
  let redis: Redis;
  let repo: RedisRepository<Widget>;

  beforeEach(() => {
    redis = makeRedisClient();
    repo = new RedisRepository<Widget>(redis, 'widget');
  });

  it('creates and retrieves an entity', async () => {
    const created = await repo.create({ name: 'foo', value: 7 });
    expect(created.id).toBeTruthy();
    const found = await repo.findById(created.id);
    expect(found).toMatchObject({ name: 'foo', value: 7 });
  });

  it('returns null for unknown id', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('updates an entity', async () => {
    const e = await repo.create({ name: 'a', value: 1 });
    const updated = await repo.update(e.id, { value: 99 });
    expect(updated?.value).toBe(99);
  });

  it('delete returns true then false', async () => {
    const e = await repo.create({ name: 'b', value: 2 });
    expect(await repo.delete(e.id)).toBe(true);
    expect(await repo.delete(e.id)).toBe(false);
  });

  it('findMany filters by where', async () => {
    await repo.create({ name: 'x', value: 1 });
    await repo.create({ name: 'y', value: 2 });
    const results = await repo.findMany({ where: { name: 'x' } });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('x');
  });
});
