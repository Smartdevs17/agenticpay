/**
 * CategoryService.test.ts — Issue #715
 *
 * Exercises CategoryService business logic against a fake CategoryRepository
 * (constructor-injected), so no Prisma mocking is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CategoryService } from '../CategoryService.js';
import type { CategoryRepository } from '../../repositories/CategoryRepository.js';

function makeCategory(over: Record<string, unknown> = {}) {
  return {
    id: 'cat-1',
    tenantId: 'tenant-1',
    name: 'Escrow',
    type: 'escrow',
    description: null,
    color: null,
    isDefault: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  };
}

function makeFakeRepository(): CategoryRepository {
  return {
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    exists: vi.fn(),
    findByTenant: vi.fn(),
    findDefaultByType: vi.fn(),
    upsertDefaultCategory: vi.fn(),
    assign: vi.fn(),
    removeAssignment: vi.fn(),
    findAssignmentsForPayment: vi.fn(),
    findWithPaymentCounts: vi.fn(),
    findAssignmentTimestamps: vi.fn(),
  } as unknown as CategoryRepository;
}

describe('CategoryService', () => {
  let repo: CategoryRepository;
  let service: CategoryService;

  beforeEach(() => {
    repo = makeFakeRepository();
    service = new CategoryService(repo);
  });

  describe('getCategory', () => {
    it('returns the category when found', async () => {
      const category = makeCategory();
      (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(category);

      await expect(service.getCategory('cat-1')).resolves.toEqual(category);
    });

    it('throws a 404 AppError when the category does not exist', async () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.getCategory('missing')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  describe('updateCategory / deleteCategory', () => {
    it('throws a 404 AppError when updating a missing category', async () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.updateCategory('missing', { name: 'New' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('throws a 404 AppError when deleting a missing category', async () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.deleteCategory('missing')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('deletes an existing category', async () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeCategory());

      await service.deleteCategory('cat-1');

      expect(repo.delete).toHaveBeenCalledWith('cat-1');
    });
  });

  describe('autoAssignCategory', () => {
    it('reuses the existing default category for the inferred type', async () => {
      const defaultCategory = makeCategory({ id: 'cat-refund', type: 'refund' });
      (repo.findDefaultByType as ReturnType<typeof vi.fn>).mockResolvedValue(defaultCategory);
      (repo.assign as ReturnType<typeof vi.fn>).mockResolvedValue({ paymentId: 'pay-1', categoryId: 'cat-refund' });

      await service.autoAssignCategory('tenant-1', 'pay-1', { type: 'refund' });

      expect(repo.findDefaultByType).toHaveBeenCalledWith('tenant-1', 'refund');
      expect(repo.upsertDefaultCategory).not.toHaveBeenCalled();
      expect(repo.assign).toHaveBeenCalledWith('pay-1', 'cat-refund');
    });

    it('creates the default category when none exists yet for the inferred type', async () => {
      (repo.findDefaultByType as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const created = makeCategory({ id: 'cat-other', type: 'other' });
      (repo.upsertDefaultCategory as ReturnType<typeof vi.fn>).mockResolvedValue(created);
      (repo.assign as ReturnType<typeof vi.fn>).mockResolvedValue({ paymentId: 'pay-1', categoryId: 'cat-other' });

      await service.autoAssignCategory('tenant-1', 'pay-1', {});

      expect(repo.upsertDefaultCategory).toHaveBeenCalledWith('tenant-1', 'other');
      expect(repo.assign).toHaveBeenCalledWith('pay-1', 'cat-other');
    });
  });

  describe('getCategoryTrend', () => {
    it('buckets assignment timestamps by day', async () => {
      (repo.findAssignmentTimestamps as ReturnType<typeof vi.fn>).mockResolvedValue([
        { createdAt: new Date('2024-03-01T10:00:00Z') },
        { createdAt: new Date('2024-03-01T18:00:00Z') },
        { createdAt: new Date('2024-03-02T09:00:00Z') },
      ]);

      const trend = await service.getCategoryTrend('tenant-1', 'cat-1');

      expect(trend).toEqual([
        { date: '2024-03-01', count: 2 },
        { date: '2024-03-02', count: 1 },
      ]);
    });
  });
});
