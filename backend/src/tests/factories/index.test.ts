import { describe, expect, it } from 'vitest';
import { makeInvoice, makePayment, makeProject, makeUser, seedTestData } from './index.js';

describe('test data factories', () => {
  it('produces repeatable values from a fixed seed', () => {
    seedTestData(42);
    const first = makeUser();
    seedTestData(42);
    expect(makeUser()).toEqual(first);
  });

  it('applies overrides and creates common Prisma input shapes', () => {
    expect(makeUser({ email: 'test@example.com' }).email).toBe('test@example.com');
    expect(makeProject({ title: 'Fixture project' }).title).toBe('Fixture project');
    expect(makePayment({ currency: 'USDC' }).currency).toBe('USDC');
    expect(makeInvoice({ currency: 'EUR' }).currency).toBe('EUR');
  });
});
