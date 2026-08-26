'use client';

import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// Payments above this amount skip optimistic updates and wait for the server.
const OPTIMISTIC_THRESHOLD = 10_000;

export interface Payment {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  network: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
  type: 'milestone_payment' | 'full_payment' | 'refund';
  projectId?: string;
  milestoneId?: string;
  userId?: string;
  fromAddress?: string;
  toAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  network: string;
  type?: Payment['type'];
  projectId?: string;
  milestoneId?: string;
  fromAddress?: string;
  toAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdatePaymentInput {
  id: string;
  status?: Payment['status'];
  metadata?: Record<string, unknown>;
}

async function apiCall<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body?.message ?? `HTTP ${res.status}`), { statusCode: res.status, body });
  }
  return res.json() as Promise<T>;
}

function buildOptimisticPayment(input: CreatePaymentInput): Payment {
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    tenantId: '',
    amount: input.amount,
    currency: input.currency,
    network: input.network,
    status: 'pending',
    type: input.type ?? 'milestone_payment',
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    metadata: input.metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Create payment ───────────────────────────────────────────────────────────

export function useCreatePayment(filters: Record<string, unknown> = {}) {
  const client = useQueryClient();
  const listKey = queryKeys.payments.list(filters);

  return useMutation<Payment, Error, CreatePaymentInput, { previous: Payment[] | undefined }>({
    mutationFn: (input) =>
      apiCall<Payment>(`${BASE_URL}/api/v1/payments`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    onMutate: async (input) => {
      if (input.amount >= OPTIMISTIC_THRESHOLD) return { previous: undefined };

      await client.cancelQueries({ queryKey: listKey });
      const previous = client.getQueryData<Payment[]>(listKey);

      const optimistic = buildOptimisticPayment(input);
      client.setQueryData<Payment[]>(listKey, (old = []) => [optimistic, ...old]);

      return { previous };
    },

    onError: (_err, _input, ctx) => {
      if (ctx?.previous !== undefined) {
        client.setQueryData<Payment[]>(listKey, ctx.previous);
      }
    },

    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.payments.lists() });
    },
  });
}

// ─── Update payment ───────────────────────────────────────────────────────────

export function useUpdatePayment(filters: Record<string, unknown> = {}) {
  const client = useQueryClient();

  return useMutation<
    Payment,
    Error,
    UpdatePaymentInput,
    { previousList: Payment[] | undefined; previousDetail: Payment | undefined }
  >({
    mutationFn: ({ id, ...body }) =>
      apiCall<Payment>(`${BASE_URL}/api/v1/payments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    onMutate: async (input) => {
      const listKey = queryKeys.payments.list(filters);
      const detailKey = queryKeys.payments.detail(input.id);

      await client.cancelQueries({ queryKey: listKey });
      await client.cancelQueries({ queryKey: detailKey });

      const previousList = client.getQueryData<Payment[]>(listKey);
      const previousDetail = client.getQueryData<Payment>(detailKey);

      const applyUpdate = (p: Payment): Payment =>
        p.id === input.id ? { ...p, ...input, updatedAt: new Date().toISOString() } : p;

      client.setQueryData<Payment[]>(listKey, (old = []) => old.map(applyUpdate));
      if (previousDetail) {
        client.setQueryData<Payment>(detailKey, applyUpdate(previousDetail));
      }

      return { previousList, previousDetail };
    },

    onError: (_err, input, ctx) => {
      if (ctx?.previousList !== undefined) {
        client.setQueryData<Payment[]>(queryKeys.payments.list(filters), ctx.previousList);
      }
      if (ctx?.previousDetail !== undefined) {
        client.setQueryData<Payment>(queryKeys.payments.detail(input.id), ctx.previousDetail);
      }
    },

    onSettled: (_data, _err, input) => {
      client.invalidateQueries({ queryKey: queryKeys.payments.lists() });
      client.invalidateQueries({ queryKey: queryKeys.payments.detail(input.id) });
    },
  });
}

// ─── Cancel payment ───────────────────────────────────────────────────────────

export function useCancelPayment(filters: Record<string, unknown> = {}) {
  const client = useQueryClient();

  return useMutation<Payment, Error, string, { previous: Payment[] | undefined }>({
    mutationFn: (id) =>
      apiCall<Payment>(`${BASE_URL}/api/v1/payments/${id}/cancel`, { method: 'POST' }),

    onMutate: async (id) => {
      const listKey = queryKeys.payments.list(filters);
      await client.cancelQueries({ queryKey: listKey });
      const previous = client.getQueryData<Payment[]>(listKey);

      client.setQueryData<Payment[]>(listKey, (old = []) =>
        old.map((p) => (p.id === id ? { ...p, status: 'cancelled', updatedAt: new Date().toISOString() } : p)),
      );

      return { previous };
    },

    onError: (_err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        client.setQueryData<Payment[]>(queryKeys.payments.list(filters), ctx.previous);
      }
    },

    onSettled: (_data, _err, id) => {
      client.invalidateQueries({ queryKey: queryKeys.payments.lists() });
      client.invalidateQueries({ queryKey: queryKeys.payments.detail(id) });
    },
  });
}

// ─── Retry failed payment ─────────────────────────────────────────────────────

export function useRetryPayment() {
  const client = useQueryClient();

  return useMutation<Payment, Error, string>({
    mutationFn: (id) =>
      apiCall<Payment>(`${BASE_URL}/api/v1/payments/${id}/retry`, { method: 'POST' }),

    onSettled: (_data, _err, id) => {
      client.invalidateQueries({ queryKey: queryKeys.payments.lists() });
      client.invalidateQueries({ queryKey: queryKeys.payments.detail(id) });
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isOptimisticId(id: string): boolean {
  return id.startsWith('optimistic-');
}

export function prefetchPayment(client: QueryClient, id: string): void {
  client.prefetchQuery({
    queryKey: queryKeys.payments.detail(id),
    queryFn: () =>
      apiCall<Payment>(`${BASE_URL}/api/v1/payments/${id}`, { method: 'GET' }),
    staleTime: 30_000,
  });
}
