"use client";

import { useCallback } from "react";
import type { Dispute } from "@agenticpay/types";
import type { CreateDisputeForm, ResolutionOutcome } from "@/types/disputes";
import {
  useAddDisputeEvidenceMutation,
  useCreateDisputeMutation,
  useDisputeQuery,
  useDisputesQuery,
  useResolveDisputeMutation,
  useRespondToDisputeMutation,
} from "@/lib/hooks/queries/useDisputesQueries";

export function useDisputes() {
  const disputesQuery = useDisputesQuery("all");
  const createMutation = useCreateDisputeMutation("all");
  const respondMutation = useRespondToDisputeMutation("all");
  const evidenceMutation = useAddDisputeEvidenceMutation("all");
  const resolveMutation = useResolveDisputeMutation("all");

  const refetch = useCallback(async () => {
    await disputesQuery.refetch();
  }, [disputesQuery]);

  return {
    disputes: (disputesQuery.data ?? []) as Dispute[],
    loading: disputesQuery.isLoading || disputesQuery.isFetching,
    error: disputesQuery.error ? disputesQuery.error.message : null,
    refetch,
    createDispute: (form: CreateDisputeForm) => createMutation.mutateAsync(form),
    respondToDispute: (disputeId: string, response: string) =>
      respondMutation.mutateAsync({ disputeId, response }),
    addEvidence: (
      disputeId: string,
      file: {
        url: string;
        name: string;
        type: string;
        size: number;
        description: string;
      }
    ) => evidenceMutation.mutateAsync({ disputeId, file }),
    resolveDispute: (
      disputeId: string,
      outcome: ResolutionOutcome,
      resolutionNote: string,
      refundAmount?: number
    ) => resolveMutation.mutateAsync({ disputeId, outcome, resolutionNote, refundAmount }),
  };
}

export function useDisputeById(id: string) {
  const disputeQuery = useDisputeQuery(id);

  return {
    dispute: (disputeQuery.data ?? null) as Dispute | null,
    loading: disputeQuery.isLoading,
    error: disputeQuery.error ? disputeQuery.error.message : null,
    setDispute: () => undefined,
  };
}
