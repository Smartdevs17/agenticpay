#!/usr/bin/env tsx
// Seed script — Issue #207
// Populates the database with representative development/staging data.

import { PrismaClient, UserTier, PaymentStatus, PaymentType, ProjectStatus, MilestoneStatus, InvoiceStatus, WebhookStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] Starting seed…');

  // ── Users ──────────────────────────────────────────────────────────────────
  const client = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: 'tenant-001', email: 'client@example.com' } },
    update: {},
    create: {
      tenantId: 'tenant-001',
      email: 'client@example.com',
      tier: UserTier.pro,
      walletAddress: 'GCLIENT123STELLARADDRESS',
      timezone: 'UTC',
    },
  });

  const freelancer = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: 'tenant-001', email: 'freelancer@example.com' } },
    update: {},
    create: {
      tenantId: 'tenant-001',
      email: 'freelancer@example.com',
      tier: UserTier.free,
      walletAddress: 'GFREELANCER456STELLARADDRESS',
      timezone: 'America/New_York',
    },
  });

  console.log('[seed] Users created:', client.id, freelancer.id);

  // ── Projects ───────────────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: { id: 'proj-seed-001' },
    update: {},
    create: {
      id: 'proj-seed-001',
      title: 'AgenticPay Frontend Redesign',
      description: 'Full redesign of the dashboard UI with RSC and analytics.',
      status: ProjectStatus.active,
      totalAmount: 5000,
      currency: 'XLM',
      clientAddress: client.walletAddress!,
      freelancerAddress: freelancer.walletAddress!,
      tenantId: 'tenant-001',
    },
  });

  console.log('[seed] Project created:', project.id);

  // ── Milestones ─────────────────────────────────────────────────────────────
  const [m1, m2, m3] = await prisma.$transaction([
    prisma.milestone.upsert({
      where: { id: 'ms-seed-001' },
      update: {},
      create: { id: 'ms-seed-001', projectId: project.id, title: 'Design Mockups', amount: 1500, currency: 'XLM', status: MilestoneStatus.completed, order: 1 },
    }),
    prisma.milestone.upsert({
      where: { id: 'ms-seed-002' },
      update: {},
      create: { id: 'ms-seed-002', projectId: project.id, title: 'Frontend Implementation', amount: 2500, currency: 'XLM', status: MilestoneStatus.in_progress, order: 2 },
    }),
    prisma.milestone.upsert({
      where: { id: 'ms-seed-003' },
      update: {},
      create: { id: 'ms-seed-003', projectId: project.id, title: 'QA & Deployment', amount: 1000, currency: 'XLM', status: MilestoneStatus.pending, order: 3 },
    }),
  ]);

  console.log('[seed] Milestones created:', m1.id, m2.id, m3.id);

  // ── Payments ───────────────────────────────────────────────────────────────
  await prisma.payment.upsert({
    where: { id: 'pay-seed-001' },
    update: {},
    create: {
      id: 'pay-seed-001',
      tenantId: 'tenant-001',
      txHash: 'abc123stellartxhash001',
      amount: 1500,
      currency: 'XLM',
      network: 'stellar',
      status: PaymentStatus.completed,
      type: PaymentType.milestone_payment,
      projectTitle: project.title,
      projectId: project.id,
      milestoneId: m1.id,
      userId: freelancer.id,
      fromAddress: client.walletAddress,
      toAddress: freelancer.walletAddress,
    },
  });

  await prisma.payment.upsert({
    where: { id: 'pay-seed-002' },
    update: {},
    create: {
      id: 'pay-seed-002',
      tenantId: 'tenant-001',
      txHash: null,
      amount: 2500,
      currency: 'XLM',
      network: 'stellar',
      status: PaymentStatus.pending,
      type: PaymentType.milestone_payment,
      projectTitle: project.title,
      projectId: project.id,
      milestoneId: m2.id,
      userId: freelancer.id,
      fromAddress: client.walletAddress,
      toAddress: freelancer.walletAddress,
    },
  });

  console.log('[seed] Payments created.');

  // ── Invoices ───────────────────────────────────────────────────────────────
  await prisma.invoice.upsert({
    where: { id: 'inv-seed-001' },
    update: {},
    create: {
      id: 'inv-seed-001',
      projectId: project.id,
      milestoneId: m1.id,
      tenantId: 'tenant-001',
      amount: 1500,
      currency: 'XLM',
      status: InvoiceStatus.paid,
      paidAt: new Date(),
    },
  });

  await prisma.invoice.upsert({
    where: { id: 'inv-seed-002' },
    update: {},
    create: {
      id: 'inv-seed-002',
      projectId: project.id,
      milestoneId: m2.id,
      tenantId: 'tenant-001',
      amount: 2500,
      currency: 'XLM',
      status: InvoiceStatus.sent,
    },
  });

  console.log('[seed] Invoices created.');

  // ── Webhooks ───────────────────────────────────────────────────────────────
  await prisma.webhook.upsert({
    where: { id: 'wh-seed-001' },
    update: {},
    create: {
      id: 'wh-seed-001',
      tenantId: 'tenant-001',
      userId: client.id,
      url: 'https://example.com/webhooks/agenticpay',
      events: ['payment.completed', 'invoice.paid', 'milestone.approved'],
      secret: 'whsec_seed_example_secret',
      status: WebhookStatus.active,
    },
  });

  console.log('[seed] Webhooks created.');

  // ── Gas Estimates ──────────────────────────────────────────────────────────
  await prisma.$transaction([
    prisma.gasEstimate.upsert({
      where: { network: 'stellar' },
      update: { gasPriceGwei: 0.00001, recordedAt: new Date() },
      create: { network: 'stellar', gasPriceGwei: 0.00001, baseFeeGwei: 0.000001 },
    }),
    prisma.gasEstimate.upsert({
      where: { network: 'ethereum' },
      update: { gasPriceGwei: 30, baseFeeGwei: 25, priorityFeeGwei: 2, recordedAt: new Date() },
      create: { network: 'ethereum', gasPriceGwei: 30, baseFeeGwei: 25, priorityFeeGwei: 2 },
    }),
  ]);

  console.log('[seed] Gas estimates created.');

  // ── Audit Logs ─────────────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      entityId: project.id,
      entityType: 'project',
      action: 'created',
      userId: client.id,
      metadata: { source: 'seed' },
    },
  });

  console.log('[seed] ✅ Seed complete.');
}

main()
  .catch((err) => {
    console.error('[seed] ❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
