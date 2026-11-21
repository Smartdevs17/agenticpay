import { faker } from '@faker-js/faker';
import type { Prisma } from '@prisma/client';

export function seedTestData(seed: number): void {
  faker.seed(seed);
}

export function makeUser(overrides: Partial<Prisma.UserUncheckedCreateInput> = {}): Prisma.UserUncheckedCreateInput {
  return {
    tenantId: faker.string.uuid(),
    email: faker.internet.email().toLowerCase(),
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Prisma.ProjectUncheckedCreateInput> = {}): Prisma.ProjectUncheckedCreateInput {
  return {
    title: faker.commerce.productName(),
    description: faker.lorem.sentence(),
    totalAmount: faker.finance.amount({ min: 10, max: 10000, dec: 2 }),
    clientAddress: faker.string.alphanumeric(56),
    freelancerAddress: faker.string.alphanumeric(56),
    tenantId: faker.string.uuid(),
    ...overrides,
  };
}

export function makePayment(overrides: Partial<Prisma.PaymentUncheckedCreateInput> = {}): Prisma.PaymentUncheckedCreateInput {
  return {
    tenantId: faker.string.uuid(),
    amount: faker.finance.amount({ min: 1, max: 5000, dec: 2 }),
    ...overrides,
  };
}

export function makeInvoice(overrides: Partial<Prisma.InvoiceUncheckedCreateInput> = {}): Prisma.InvoiceUncheckedCreateInput {
  return {
    projectId: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    amount: faker.finance.amount({ min: 1, max: 5000, dec: 2 }),
    ...overrides,
  };
}
