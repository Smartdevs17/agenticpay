import { describe, expect, it } from 'vitest';
import {
  storeVerification,
  updateVerification,
  deleteVerification,
  getVerification,
} from '../verification.js';

const baseVerification = {
  projectId: 'project-1',
  status: 'pending' as const,
  score: 50,
  summary: 'Initial review',
  details: ['Initial note'],
  verifiedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
};

describe('verification bulk helpers', () => {
  it('updates existing verification entries', () => {
    const id = 'ver_update_test';
    storeVerification({ ...baseVerification, id });

    const updated = updateVerification({ id, status: 'passed', score: 90 });

    expect(updated?.status).toBe('passed');
    expect(updated?.score).toBe(90);
  });

  it('deletes verification entries', async () => {
    const id = 'ver_delete_test';
    storeVerification({ ...baseVerification, id });

    const deleted = deleteVerification(id);

    expect(deleted).toBe(true);
    await expect(getVerification(id)).resolves.toBeUndefined();
  });
});
