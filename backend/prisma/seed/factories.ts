// Seed factories — Issue #525
// Factory functions for generating realistic test data with Faker.js

import { PrismaClient, UserTier, PaymentStatus, PaymentType, ProjectStatus, MilestoneStatus, InvoiceStatus, WebhookStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

// Simple seeded random for deterministic generation without external deps
class SeededRandom {
  private seed: number;

  constructor(seed: number = 12345) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextChoice<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  nextEmail(): string {
    const domains = ['example.com', 'test.com', 'dev.io'];
    const adjectives = ['happy', 'lucky', 'clever', 'swift', 'bright'];
    const nouns = ['dragon', 'fox', 'eagle', 'wolf', 'bear'];
    const adj = this.nextChoice(adjectives);
    const noun = this.nextChoice(nouns);
    const domain = this.nextChoice(domains);
    const num = this.nextInt(1, 9999);
    return `${adj}${noun}${num}@${domain}`;
  }

  nextWalletAddress(): string {
    const hex = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let addr = '';
    for (let i = 0; i < 56; i++) {
      addr += hex[this.nextInt(0, hex.length - 1)];
    }
    return addr;
  }

  nextAmount(min: number = 100, max: number = 10000): Decimal {
    return new Decimal(this.nextInt(min * 100, max * 100) / 100);
  }

  nextFutureDate(daysFromNow: number = 30): Date {
    const now = new Date();
    const days = this.nextInt(1, daysFromNow);
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  nextPastDate(daysAgo: number = 90): Date {
    const now = new Date();
    const days = this.nextInt(1, daysAgo);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  nextString(length: number = 10): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[this.nextInt(0, chars.length - 1)];
    }
    return result;
  }
}

export interface FactoryContext {
  rng: SeededRandom;
  tenantId: string;
}

export class UserFactory {
  static create(ctx: FactoryContext, overrides: any = {}) {
    return {
      tenantId: ctx.tenantId,
      email: ctx.rng.nextEmail(),
      tier: ctx.rng.nextChoice([UserTier.free, UserTier.pro, UserTier.enterprise]),
      walletAddress: ctx.rng.nextWalletAddress(),
      timezone: 'UTC',
      ...overrides,
    };
  }
}

export class ProjectFactory {
  static create(ctx: FactoryContext, clientAddr: string, freelancerAddr: string, overrides: any = {}) {
    const amount = ctx.rng.nextAmount(1000, 50000);
    return {
      id: `proj-${ctx.rng.nextString(8)}`,
      tenantId: ctx.tenantId,
      title: `Project ${ctx.rng.nextString(6)}`,
      description: `A sample project for testing purposes`,
      status: ctx.rng.nextChoice([ProjectStatus.active, ProjectStatus.completed]),
      totalAmount: amount,
      currency: 'XLM',
      clientAddress: clientAddr,
      freelancerAddress: freelancerAddr,
      ...overrides,
    };
  }
}

export class MilestoneFactory {
  static create(ctx: FactoryContext, projectId: string, index: number = 0, overrides: any = {}) {
    const amount = ctx.rng.nextAmount(100, 5000);
    return {
      id: `ms-${ctx.rng.nextString(8)}`,
      projectId,
      title: `Milestone ${index + 1}: ${ctx.rng.nextString(10)}`,
      amount,
      currency: 'XLM',
      status: ctx.rng.nextChoice([MilestoneStatus.pending, MilestoneStatus.in_progress, MilestoneStatus.completed]),
      order: index,
      ...overrides,
    };
  }
}

export class PaymentFactory {
  static create(ctx: FactoryContext, overrides: any = {}) {
    const status = ctx.rng.nextChoice([PaymentStatus.pending, PaymentStatus.completed]);
    return {
      id: `pay-${ctx.rng.nextString(8)}`,
      tenantId: ctx.tenantId,
      txHash: status === PaymentStatus.completed ? `tx${ctx.rng.nextString(64)}` : null,
      amount: ctx.rng.nextAmount(100, 5000),
      currency: 'XLM',
      network: 'stellar',
      status,
      type: PaymentType.milestone_payment,
      metadata: { generatedBy: 'factory' },
      ...overrides,
    };
  }
}

export class InvoiceFactory {
  static create(ctx: FactoryContext, projectId: string, overrides: any = {}) {
    const status = ctx.rng.nextChoice([InvoiceStatus.draft, InvoiceStatus.sent, InvoiceStatus.paid]);
    return {
      id: `inv-${ctx.rng.nextString(8)}`,
      projectId,
      tenantId: ctx.tenantId,
      amount: ctx.rng.nextAmount(100, 5000),
      currency: 'XLM',
      status,
      generatedAt: new Date(),
      dueAt: ctx.rng.nextFutureDate(30),
      paidAt: status === InvoiceStatus.paid ? ctx.rng.nextPastDate(30) : null,
      ...overrides,
    };
  }
}

export class WebhookFactory {
  static create(ctx: FactoryContext, userId: string, overrides: any = {}) {
    return {
      id: `wh-${ctx.rng.nextString(8)}`,
      tenantId: ctx.tenantId,
      userId,
      url: `https://example.com/webhooks/${ctx.rng.nextString(12)}`,
      events: ['payment.completed', 'invoice.paid'],
      secret: `whsec_${ctx.rng.nextString(32)}`,
      status: WebhookStatus.active,
      ...overrides,
    };
  }
}

export async function seedFactories(
  prisma: PrismaClient,
  tenantId: string,
  userCount: number = 10,
  projectsPerUser: number = 5,
  milestonesPerProject: number = 3,
  paymentsPerMilestone: number = 1,
  invoicesPerProject: number = 2,
  rngSeed: number = 12345,
) {
  const ctx: FactoryContext = { rng: new SeededRandom(rngSeed), tenantId };

  console.log(`[seed:factories] Generating ${userCount} users…`);
  const users = [];
  for (let i = 0; i < userCount; i++) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: ctx.rng.nextEmail() } },
      update: {},
      create: UserFactory.create(ctx),
    });
    users.push(user);
  }
  console.log(`[seed:factories] ✅ Created ${users.length} users`);

  console.log(`[seed:factories] Generating ${projectsPerUser * users.length} projects…`);
  const projects = [];
  for (let i = 0; i < Math.min(users.length - 1, 10); i++) {
    const client = users[i];
    const freelancer = users[i + 1];
    for (let j = 0; j < projectsPerUser; j++) {
      const project = await prisma.project.upsert({
        where: { id: `proj-${tenantId}-${i}-${j}` },
        update: {},
        create: ProjectFactory.create(ctx, client.walletAddress!, freelancer.walletAddress!),
      });
      projects.push(project);
    }
  }
  console.log(`[seed:factories] ✅ Created ${projects.length} projects`);

  console.log(`[seed:factories] Generating milestones and payments…`);
  let totalMilestones = 0;
  let totalPayments = 0;
  for (const project of projects.slice(0, 10)) {
    for (let m = 0; m < milestonesPerProject; m++) {
      const milestone = await prisma.milestone.upsert({
        where: { id: `ms-${project.id}-${m}` },
        update: {},
        create: MilestoneFactory.create(ctx, project.id, m),
      });
      totalMilestones++;

      for (let p = 0; p < paymentsPerMilestone; p++) {
        const user = users[Math.floor(Math.random() * users.length)];
        await prisma.payment.upsert({
          where: { id: `pay-${milestone.id}-${p}` },
          update: {},
          create: PaymentFactory.create(ctx, {
            projectId: project.id,
            milestoneId: milestone.id,
            userId: user.id,
            fromAddress: project.clientAddress,
            toAddress: project.freelancerAddress,
          }),
        });
        totalPayments++;
      }
    }
  }
  console.log(`[seed:factories] ✅ Created ${totalMilestones} milestones and ${totalPayments} payments`);

  console.log(`[seed:factories] Generating invoices…`);
  let totalInvoices = 0;
  for (const project of projects.slice(0, 10)) {
    for (let i = 0; i < invoicesPerProject; i++) {
      await prisma.invoice.upsert({
        where: { id: `inv-${project.id}-${i}` },
        update: {},
        create: InvoiceFactory.create(ctx, project.id),
      });
      totalInvoices++;
    }
  }
  console.log(`[seed:factories] ✅ Created ${totalInvoices} invoices`);

  return { users, projects, totalMilestones, totalPayments, totalInvoices };
}
