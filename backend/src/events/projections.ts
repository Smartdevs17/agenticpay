import { subscribe } from './event-bus.js';
import type { StoredEvent } from './event-types.js';

export interface PaymentReadModel {
  paymentId: string;
  from: string;
  to: string;
  amount: number;
  asset: string;
  status: 'pending' | 'executed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface ProjectReadModel {
  projectId: string;
  client: string;
  freelancer?: string;
  amount: number;
  status: string;
  repoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationReadModel {
  verificationId: string;
  projectId: string;
  repositoryUrl: string;
  status: 'requested' | 'passed' | 'failed';
  score?: number;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

const paymentProjection = new Map<string, PaymentReadModel>();
const projectProjection = new Map<string, ProjectReadModel>();
const verificationProjection = new Map<string, VerificationReadModel>();

function now(): string {
  return new Date().toISOString();
}

subscribe('payment.created', (event: StoredEvent) => {
  const p = event.payload as { from: string; to: string; amount: number; asset: string };
  paymentProjection.set(event.aggregateId, {
    paymentId: event.aggregateId,
    from: p.from,
    to: p.to,
    amount: p.amount,
    asset: p.asset,
    status: 'pending',
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
  });
});

subscribe('payment.executed', (event: StoredEvent) => {
  const m = paymentProjection.get(event.aggregateId);
  if (m) paymentProjection.set(event.aggregateId, { ...m, status: 'executed', updatedAt: now() });
});

subscribe('payment.failed', (event: StoredEvent) => {
  const m = paymentProjection.get(event.aggregateId);
  if (m) paymentProjection.set(event.aggregateId, { ...m, status: 'failed', updatedAt: now() });
});

subscribe('payment.cancelled', (event: StoredEvent) => {
  const m = paymentProjection.get(event.aggregateId);
  if (m) paymentProjection.set(event.aggregateId, { ...m, status: 'cancelled', updatedAt: now() });
});

subscribe('project.created', (event: StoredEvent) => {
  const p = event.payload as { client: string; amount: number };
  projectProjection.set(event.aggregateId, {
    projectId: event.aggregateId,
    client: p.client,
    amount: p.amount,
    status: 'created',
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
  });
});

subscribe('project.funded', (event: StoredEvent) => {
  const m = projectProjection.get(event.aggregateId);
  if (m) projectProjection.set(event.aggregateId, { ...m, status: 'funded', updatedAt: now() });
});

subscribe('project.work_submitted', (event: StoredEvent) => {
  const p = event.payload as { repoUrl?: string };
  const m = projectProjection.get(event.aggregateId);
  if (m)
    projectProjection.set(event.aggregateId, {
      ...m,
      status: 'work_submitted',
      repoUrl: p.repoUrl,
      updatedAt: now(),
    });
});

subscribe('project.work_approved', (event: StoredEvent) => {
  const m = projectProjection.get(event.aggregateId);
  if (m) projectProjection.set(event.aggregateId, { ...m, status: 'completed', updatedAt: now() });
});

subscribe('project.disputed', (event: StoredEvent) => {
  const m = projectProjection.get(event.aggregateId);
  if (m) projectProjection.set(event.aggregateId, { ...m, status: 'disputed', updatedAt: now() });
});

subscribe('verification.requested', (event: StoredEvent) => {
  const p = event.payload as { projectId: string; repositoryUrl: string };
  verificationProjection.set(event.aggregateId, {
    verificationId: event.aggregateId,
    projectId: p.projectId,
    repositoryUrl: p.repositoryUrl,
    status: 'requested',
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
  });
});

subscribe('verification.passed', (event: StoredEvent) => {
  const p = event.payload as { score?: number; summary?: string };
  const m = verificationProjection.get(event.aggregateId);
  if (m)
    verificationProjection.set(event.aggregateId, {
      ...m,
      status: 'passed',
      score: p.score,
      summary: p.summary,
      updatedAt: now(),
    });
});

subscribe('verification.failed', (event: StoredEvent) => {
  const p = event.payload as { score?: number; summary?: string };
  const m = verificationProjection.get(event.aggregateId);
  if (m)
    verificationProjection.set(event.aggregateId, {
      ...m,
      status: 'failed',
      score: p.score,
      summary: p.summary,
      updatedAt: now(),
    });
});

export function getPaymentReadModel(paymentId: string): PaymentReadModel | undefined {
  return paymentProjection.get(paymentId);
}

export function getAllPayments(): PaymentReadModel[] {
  return Array.from(paymentProjection.values());
}

export function getProjectReadModel(projectId: string): ProjectReadModel | undefined {
  return projectProjection.get(projectId);
}

export function getAllProjects(): ProjectReadModel[] {
  return Array.from(projectProjection.values());
}

export function getVerificationReadModel(verificationId: string): VerificationReadModel | undefined {
  return verificationProjection.get(verificationId);
}

export function getAllVerifications(): VerificationReadModel[] {
  return Array.from(verificationProjection.values());
}
