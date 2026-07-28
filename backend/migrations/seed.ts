#!/usr/bin/env tsx
// Seed script — Issues #207, #525
// Populates the database with representative development/staging data.
// Usage: npm run db:seed [-- --size=small|medium|large --scenario=disputes]

import { PrismaClient, UserTier, PaymentStatus, PaymentType, ProjectStatus, MilestoneStatus, InvoiceStatus, WebhookStatus } from '@prisma/client';
import { seedFactories } from '../prisma/seed/factories';
import { getScenario, listScenarios } from '../prisma/seed/scenarios';

const prisma = new PrismaClient();

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { size: 'small', scenario: undefined };

  for (const arg of args) {
    if (arg.startsWith('--size=')) {
      config.size = arg.split('=')[1];
    }
    if (arg.startsWith('--scenario=')) {
      config.scenario = arg.split('=')[1];
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();
  const scenarioName = config.scenario || config.size;
  const scenario = getScenario(scenarioName);

  console.log('[seed] Starting seed…');
  console.log(`[seed] Scenario: ${scenario.name}`);
  console.log(`[seed] Description: ${scenario.description}`);

  const tenantId = 'tenant-001';

  // ── Legacy seed data (for backward compatibility) ──────────────────────────
  const client = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: 'client@example.com' } },
    update: {},
    create: {
      tenantId,
      email: 'client@example.com',
      tier: UserTier.pro,
      walletAddress: 'GCLIENT123STELLARADDRESS',
      timezone: 'UTC',
    },
  });

  const freelancer = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: 'freelancer@example.com' } },
    update: {},
    create: {
      tenantId,
      email: 'freelancer@example.com',
      tier: UserTier.free,
      walletAddress: 'GFREELANCER456STELLARADDRESS',
      timezone: 'America/New_York',
    },
  });

  console.log('[seed] Legacy users created:', client.id, freelancer.id);

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

  // ── Factory-based seed data ────────────────────────────────────────────────
  const result = await seedFactories(
    prisma,
    tenantId,
    scenario.userCount,
    scenario.projectsPerUser,
    scenario.milestonesPerProject,
    scenario.paymentsPerMilestone,
    scenario.invoicesPerProject,
    12345, // deterministic seed
  );

  console.log('[seed] Factory seed summary:');
  console.log(`  Users: ${result.users.length}`);
  console.log(`  Projects: ${result.projects.length}`);
  console.log(`  Milestones: ${result.totalMilestones}`);
  console.log(`  Payments: ${result.totalPayments}`);
  console.log(`  Invoices: ${result.totalInvoices}`);

  console.log('[seed] ✅ Seed complete.');
  console.log(`[seed] Available scenarios: ${listScenarios().join(', ')}`);
  console.log('[seed] Usage: npm run db:seed [-- --scenario=<name>]');
}

main()
  .catch((err) => {
    console.error('[seed] ❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
