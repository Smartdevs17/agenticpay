/**
 * backend/src/repositories/index.ts
 *
 * Central composition root for the repository layer (Issue #1404).
 * Exports all domain repositories, default singletons, and unit-of-work transaction helper.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

export * from './interfaces/Repository.js';
export * from './BaseRepository.js';
export * from './InMemoryRepository.js';
export * from './implementations/PrismaRepository.js';

export * from './PaymentRepository.js';
export * from './UserRepository.js';
export * from './InvoiceRepository.js';
export * from './WebhookRepository.js';
export * from './NotificationRepository.js';
export * from './AuditLogRepository.js';
export * from './GasEstimateRepository.js';
export * from './EmailRepository.js';
export * from './ReportRepository.js';
export * from './InstallmentRepository.js';
export * from './SandboxRepository.js';
export * from './ProjectRepository.js';
export * from './CategoryRepository.js';
export * from './ComplianceRepository.js';
export * from './APIKeyRepository.js';
export * from './OnboardingRepository.js';
export * from './DisputeEvidenceRepository.js';

import { PaymentRepository } from './PaymentRepository.js';
import { UserRepository } from './UserRepository.js';
import { InvoiceRepository } from './InvoiceRepository.js';
import { WebhookRepository } from './WebhookRepository.js';
import { NotificationRepository } from './NotificationRepository.js';
import { AuditLogRepository } from './AuditLogRepository.js';
import { GasEstimateRepository } from './GasEstimateRepository.js';
import { EmailRepository } from './EmailRepository.js';
import { ReportRepository } from './ReportRepository.js';
import { InstallmentRepository } from './InstallmentRepository.js';
import { SandboxRepository } from './SandboxRepository.js';
import { DisputeEvidenceRepository } from './DisputeEvidenceRepository.js';

export interface TransactionRepositories {
  payment: PaymentRepository;
  user: UserRepository;
  invoice: InvoiceRepository;
  webhook: WebhookRepository;
  notification: NotificationRepository;
  auditLog: AuditLogRepository;
  gasEstimate: GasEstimateRepository;
  email: EmailRepository;
  report: ReportRepository;
  installment: InstallmentRepository;
  sandbox: SandboxRepository;
  disputeEvidence: DisputeEvidenceRepository;
}

/**
 * Executes a unit of work within an atomic Prisma database transaction,
 * injecting transaction-scoped repositories.
 */
export async function runInTransaction<T>(
  fn: (repos: TransactionRepositories) => Promise<T>,
  client: PrismaClient = prisma
): Promise<T> {
  return (client as any).$transaction(async (tx: any) => {
    const repos: TransactionRepositories = {
      payment: new PaymentRepository(tx),
      user: new UserRepository(tx),
      invoice: new InvoiceRepository(tx),
      webhook: new WebhookRepository(tx),
      notification: new NotificationRepository(tx),
      auditLog: new AuditLogRepository(tx),
      gasEstimate: new GasEstimateRepository(tx),
      email: new EmailRepository(tx),
      report: new ReportRepository(tx),
      installment: new InstallmentRepository(tx),
      sandbox: new SandboxRepository(tx),
      disputeEvidence: new DisputeEvidenceRepository(tx),
    };
    return fn(repos);
  });
}
