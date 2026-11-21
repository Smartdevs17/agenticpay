import type { CurrencyCode, ISO8601, UUID } from './primitives.js';

export type ProjectStatus =
  | 'draft'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'archived'
  | 'disputed'
  | 'abandoned';

export type MilestoneStatus =
  | 'pending'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'released'
  | 'completed'
  | 'disputed';

export interface Milestone {
  id: UUID;
  projectId?: UUID;
  title: string;
  deliverable?: string;
  amount: number;
  currency?: CurrencyCode;
  dueDate?: ISO8601;
  status: MilestoneStatus;
  submittedAt?: ISO8601 | null;
  approvedAt?: ISO8601 | null;
  submissionUrl?: string | null;
  submissionNotes?: string | null;
  disputeReason?: string | null;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface Project {
  id: UUID;
  name?: string;
  title?: string;
  clientId?: UUID;
  ownerId?: UUID;
  budget?: number;
  spentBudget?: number;
  totalAmount?: number;
  currency: CurrencyCode;
  startDate?: ISO8601;
  endDate?: ISO8601 | null;
  description?: string;
  status: ProjectStatus;
  archivedAt?: ISO8601 | null;
  createdAt: ISO8601;
  updatedAt: ISO8601;
  scopeChangeCount?: number;
}
