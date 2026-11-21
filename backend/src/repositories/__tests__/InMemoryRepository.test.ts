import { describe, it, expect } from 'vitest';
import { InMemoryRepository } from '../InMemoryRepository.js';
import { ProjectRepository } from '../ProjectRepository.js';
import { ComplianceAlertRepository } from '../ComplianceRepository.js';
import { OnboardingRepository } from '../OnboardingRepository.js';

interface Widget {
  id: string;
  label: string;
  createdAt: string;
}

class WidgetRepository extends InMemoryRepository<Widget> {
  protected getId(entity: Widget): string {
    return entity.id;
  }

  protected getSortTimestamp(entity: Widget): number {
    return new Date(entity.createdAt).getTime();
  }

  async create(data: Partial<Widget>): Promise<Widget> {
    if (!data.id) throw new Error('id is required');
    return this.put(data as Widget);
  }

  async update(id: string, data: Partial<Widget>): Promise<Widget | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    return this.put({ ...existing, ...data });
  }
}

describe('InMemoryRepository (shared base behavior)', () => {
  it('findById returns null for missing entities', async () => {
    const repo = new WidgetRepository();
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findAll sorts most-recent first and paginates with a cursor', async () => {
    const repo = new WidgetRepository();
    await repo.create({ id: 'a', label: 'a', createdAt: '2024-01-01T00:00:00.000Z' });
    await repo.create({ id: 'b', label: 'b', createdAt: '2024-01-03T00:00:00.000Z' });
    await repo.create({ id: 'c', label: 'c', createdAt: '2024-01-02T00:00:00.000Z' });

    const page1 = await repo.findAll({ limit: 2 });
    expect(page1.items.map((w) => w.id)).toEqual(['b', 'c']);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBe('c');

    const page2 = await repo.findAll({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((w) => w.id)).toEqual(['a']);
    expect(page2.hasMore).toBe(false);
  });

  it('delete removes the entity and count/filters work generically', async () => {
    const repo = new WidgetRepository();
    await repo.create({ id: 'a', label: 'x', createdAt: '2024-01-01T00:00:00.000Z' });
    await repo.create({ id: 'b', label: 'y', createdAt: '2024-01-02T00:00:00.000Z' });

    expect(await repo.count()).toBe(2);
    expect(await repo.count({ label: 'x' })).toBe(1);

    expect(await repo.delete('a')).toBe(true);
    expect(await repo.delete('a')).toBe(false);
    expect(await repo.count()).toBe(1);
  });
});

describe('ProjectRepository (built on InMemoryRepository)', () => {
  it('creates a project, updates it, and lists it by tenant', async () => {
    const repo = new ProjectRepository();
    const project = await repo.create({
      clientId: 'client-1',
      freelancerId: 'freelancer-1',
      amount: 100,
      githubRepo: 'org/repo',
      description: 'test project',
      tenantId: 'tenant-1',
    });

    expect(project.status).toBe('created');

    const updated = await repo.update(project.id, { status: 'funded' });
    expect(updated?.status).toBe('funded');
    expect(updated?.id).toBe(project.id);

    const byTenant = await repo.findByTenant('tenant-1', { limit: 10 });
    expect(byTenant.items).toHaveLength(1);
    expect(byTenant.items[0].id).toBe(project.id);

    expect(await repo.count({ tenantId: 'tenant-1', status: 'funded' })).toBe(1);
  });
});

describe('ComplianceAlertRepository (built on InMemoryRepository)', () => {
  it('filters alerts by status and jurisdiction', async () => {
    const repo = new ComplianceAlertRepository();
    await repo.create({
      id: 'alert-1',
      status: 'open',
      jurisdiction: 'US',
      triggeredAt: '2024-01-01T00:00:00.000Z',
    } as never);
    await repo.create({
      id: 'alert-2',
      status: 'closed',
      jurisdiction: 'EU',
      triggeredAt: '2024-01-02T00:00:00.000Z',
    } as never);

    expect(repo.findByStatus('open')).toHaveLength(1);
    expect(repo.findByJurisdiction('EU')).toHaveLength(1);
  });
});

describe('OnboardingRepository (built on InMemoryRepository)', () => {
  it('bumps updatedAt on update and finds by merchantId', async () => {
    const repo = new OnboardingRepository();
    await repo.create({
      id: 'onboard-1',
      merchantId: 'merchant-1',
      status: 'pending',
      createdAt: '2024-01-01T00:00:00.000Z',
    } as never);

    const found = repo.findByMerchantId('merchant-1');
    expect(found?.id).toBe('onboard-1');

    const updated = await repo.update('onboard-1', { status: 'active' } as never);
    expect(updated?.status).toBe('active');
    expect(updated?.updatedAt).toBeTruthy();
  });
});
