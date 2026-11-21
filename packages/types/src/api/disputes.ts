import type { CreateDisputeInput, Dispute, ResolutionOutcome } from '../domain/disputes.js';
import type { PaginatedResult, PaginationParams } from './common.js';

export interface ListDisputesRequest extends PaginationParams {
  role?: 'payer' | 'payee' | 'arbitrator' | 'all';
}

export type ListDisputesResponse = PaginatedResult<Dispute> | Dispute[];

export type CreateDisputeRequest = CreateDisputeInput;

export type ResolveDisputeRequest = {
  outcome: ResolutionOutcome;
  resolutionNote: string;
  refundAmount?: number;
};
