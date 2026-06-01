import { describe, it, expect } from 'vitest';
import { ZKIdentityService } from '../services/zk-identity-service.js';
import type { AgeVerificationInput } from '../types/zk-types.js';

function baseInput(overrides: Partial<AgeVerificationInput> = {}): AgeVerificationInput {
  return {
    birthYear: 2000,
    birthMonth: 1,
    birthDay: 15,
    currentYear: 2026,
    currentMonth: 5,
    currentDay: 29,
    minAge: 18,
    ...overrides,
  };
}

describe('ZK age verification boundaries', () => {
  it('accepts subjects exactly at the 18-year threshold', () => {
    const input = baseInput({
      birthYear: 2008,
      birthMonth: 5,
      birthDay: 29,
      minAge: 18,
    });
    expect(ZKIdentityService.computeAgeYears(input)).toBeGreaterThanOrEqual(18);
  });

  it('rejects subjects one day under the 21-year threshold', async () => {
    const service = new ZKIdentityService();
    const input = baseInput({
      birthYear: 2005,
      birthMonth: 5,
      birthDay: 30,
      minAge: 21,
    });

    await expect(service.generateAgeProof(input)).rejects.toThrow(/minimum age/i);
  });

  it('encodes YYYYMMDD circuit inputs consistently', () => {
    expect(ZKIdentityService.toDateInt(2000, 1, 15)).toBe(20000115);
    expect(ZKIdentityService.toDateInt(2026, 5, 29)).toBe(20260529);
  });
});
