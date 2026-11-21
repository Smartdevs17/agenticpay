import { describe, it, expect, vi, beforeEach } from 'vitest';

const onboardingChecklistMock = {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    onboardingChecklist: onboardingChecklistMock,
  },
}));

const { onboardingChecklistService } = await import('../onboarding-checklist.js');

describe('OnboardingChecklistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrCreateChecklist', () => {
    it('creates a checklist from the role template on first access', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue(null);
      onboardingChecklistMock.create.mockImplementation(async ({ data }: any) => ({ id: 'chk-1', ...data }));

      const checklist = await onboardingChecklistService.getOrCreateChecklist('tenant-1', 'user-1', 'admin');

      expect(onboardingChecklistMock.create).toHaveBeenCalled();
      expect((checklist as any).tasks.length).toBeGreaterThan(0);
      expect((checklist as any).tasks.every((t: any) => !t.completed)).toBe(true);
      expect((checklist as any).completionPercent).toBe(0);
    });

    it('returns the existing checklist without recreating it', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue({ id: 'chk-1', tasks: [] });

      const checklist = await onboardingChecklistService.getOrCreateChecklist('tenant-1', 'user-1', 'member');

      expect(onboardingChecklistMock.create).not.toHaveBeenCalled();
      expect(checklist).toEqual({ id: 'chk-1', tasks: [] });
    });

    it('rejects an unknown role', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue(null);
      await expect(
        onboardingChecklistService.getOrCreateChecklist('tenant-1', 'user-1', 'bogus' as any)
      ).rejects.toMatchObject({ code: 'UNKNOWN_ROLE' });
    });

    it('gives different task sets per role', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue(null);
      onboardingChecklistMock.create.mockImplementation(async ({ data }: any) => ({ id: 'chk', ...data }));

      const owner = await onboardingChecklistService.getOrCreateChecklist('t', 'u', 'owner');
      const viewer = await onboardingChecklistService.getOrCreateChecklist('t', 'u', 'viewer');

      expect((owner as any).tasks).not.toEqual((viewer as any).tasks);
    });
  });

  describe('completeTask', () => {
    it('marks a task complete and recomputes completion percentage', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue({
        tenantId: 't',
        userId: 'u',
        tasks: [
          { id: 'task-a', title: 'A', completed: false, completedAt: null },
          { id: 'task-b', title: 'B', completed: false, completedAt: null },
        ],
      });
      onboardingChecklistMock.update.mockImplementation(async ({ data }: any) => data);

      const result = await onboardingChecklistService.completeTask('t', 'u', 'task-a');

      expect(result.completionPercent).toBe(50);
      expect(result.tasks.find((t: any) => t.id === 'task-a').completed).toBe(true);
      expect(result.completedAt).toBeNull();
    });

    it('sets completedAt once all tasks are done', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue({
        tenantId: 't',
        userId: 'u',
        tasks: [{ id: 'task-a', title: 'A', completed: false, completedAt: null }],
      });
      onboardingChecklistMock.update.mockImplementation(async ({ data }: any) => data);

      const result = await onboardingChecklistService.completeTask('t', 'u', 'task-a');

      expect(result.completionPercent).toBe(100);
      expect(result.completedAt).not.toBeNull();
    });

    it('throws when the checklist does not exist', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue(null);
      await expect(onboardingChecklistService.completeTask('t', 'u', 'task-a')).rejects.toMatchObject({
        code: 'CHECKLIST_NOT_FOUND',
      });
    });

    it('throws when the task id is unknown', async () => {
      onboardingChecklistMock.findUnique.mockResolvedValue({
        tenantId: 't',
        userId: 'u',
        tasks: [{ id: 'task-a', title: 'A', completed: false, completedAt: null }],
      });
      await expect(onboardingChecklistService.completeTask('t', 'u', 'does-not-exist')).rejects.toMatchObject({
        code: 'TASK_NOT_FOUND',
      });
    });
  });
});
