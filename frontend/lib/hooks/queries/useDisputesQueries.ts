"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateDisputeInput,
  Dispute,
  ListDisputesResponse,
  ResolutionOutcome,
} from "@agenticpay/types";
import { mockDisputes } from "@/lib/mock-data/disputes";
import { queryKeys } from "@/lib/query-keys";
import { apiFetch } from "@/lib/queries/api";

type CreateDisputeForm = CreateDisputeInput;

function normalizeDisputes(response: ListDisputesResponse): Dispute[] {
  return Array.isArray(response) ? response : response.data;
}

async function listDisputes(role = "all", page?: number): Promise<Dispute[]> {
  if (process.env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return mockDisputes;
  }

  const search = new URLSearchParams({ role });
  if (page) search.set("page", String(page));
  return normalizeDisputes(await apiFetch<ListDisputesResponse>(`/api/v1/disputes?${search}`));
}

function makeOptimisticDispute(form: CreateDisputeForm): Dispute {
  const now = new Date().toISOString();
  return {
    id: `optimistic_${Date.now()}`,
    ...form,
    filedBy: "current_user",
    status: "awaiting_response",
    evidence: [],
    messages: [],
    resolution: "pending",
    responseDeadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    escalationDeadline: new Date(Date.now() + 168 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
}

export function useDisputesQuery(role = "all") {
  return useQuery({
    queryKey: queryKeys.disputes.list({ role }),
    queryFn: () => listDisputes(role),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    throwOnError: false,
  });
}

export function useInfiniteDisputesQuery(role = "all") {
  return useInfiniteQuery({
    queryKey: queryKeys.disputes.infinite({ role }),
    queryFn: ({ pageParam }) => listDisputes(role, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === 0 ? undefined : allPages.length + 1),
  });
}

export function useDisputeQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.disputes.detail(id),
    queryFn: async () => {
      if (process.env.NODE_ENV === "development") {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return mockDisputes.find((dispute) => dispute.id === id) ?? null;
      }
      return apiFetch<Dispute>(`/api/v1/disputes/${id}`);
    },
    enabled: Boolean(id),
  });
}

export function useCreateDisputeMutation(role = "all") {
  const queryClient = useQueryClient();
  const listKey = queryKeys.disputes.list({ role });

  return useMutation({
    mutationFn: async (form: CreateDisputeForm) => {
      if (process.env.NODE_ENV === "development") return makeOptimisticDispute(form);
      return apiFetch<Dispute>("/api/v1/disputes", {
        method: "POST",
        body: JSON.stringify(form),
      });
    },
    onMutate: async (form) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<Dispute[]>(listKey);
      const optimistic = makeOptimisticDispute(form);
      queryClient.setQueryData<Dispute[]>(listKey, (current = []) => [optimistic, ...current]);
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_error, _form, context) => {
      queryClient.setQueryData(listKey, context?.previous ?? []);
    },
    onSuccess: (created, _form, context) => {
      queryClient.setQueryData<Dispute[]>(listKey, (current = []) =>
        current.map((dispute) => (dispute.id === context?.optimisticId ? created : dispute))
      );
      queryClient.setQueryData(queryKeys.disputes.detail(created.id), created);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.disputes.lists() });
    },
  });
}

export function useRespondToDisputeMutation(role = "all") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, response }: { disputeId: string; response: string }) =>
      apiFetch<Dispute>(`/api/v1/disputes/${disputeId}/respond`, {
        method: "POST",
        body: JSON.stringify({ response }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.disputes.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.disputes.list({ role }) });
    },
  });
}

export function useAddDisputeEvidenceMutation(role = "all") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      disputeId,
      file,
    }: {
      disputeId: string;
      file: { url: string; name: string; type: string; size: number; description: string };
    }) =>
      apiFetch(`/api/v1/disputes/${disputeId}/evidence`, {
        method: "POST",
        body: JSON.stringify(file),
      }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.disputes.detail(variables.disputeId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.disputes.list({ role }) });
    },
  });
}

export function useResolveDisputeMutation(role = "all") {
  const queryClient = useQueryClient();
  const listKey = queryKeys.disputes.list({ role });

  return useMutation({
    mutationFn: ({
      disputeId,
      outcome,
      resolutionNote,
      refundAmount,
    }: {
      disputeId: string;
      outcome: ResolutionOutcome;
      resolutionNote: string;
      refundAmount?: number;
    }) =>
      apiFetch<Dispute>(`/api/v1/disputes/${disputeId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ outcome, resolutionNote, refundAmount }),
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<Dispute[]>(listKey);
      queryClient.setQueryData<Dispute[]>(listKey, (current = []) =>
        current.map((dispute) =>
          dispute.id === variables.disputeId
            ? {
                ...dispute,
                status: "resolved",
                resolution: variables.outcome,
                resolutionNote: variables.resolutionNote,
                refundAmount: variables.refundAmount,
                updatedAt: new Date().toISOString(),
              }
            : dispute
        )
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(listKey, context?.previous ?? []);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.disputes.detail(updated.id), updated);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.disputes.lists() });
    },
  });
}
