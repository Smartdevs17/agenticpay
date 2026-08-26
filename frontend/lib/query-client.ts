"use client";

import { QueryClient } from "@tanstack/react-query";

declare global {
  interface Window {
    __AGENTICPAY_QUERY_CLIENT__?: QueryClient;
  }
}

export const queryStaleTimes = {
  realtime: 5_000,
  transactional: 30_000,
  reference: 5 * 60_000,
  admin: 15_000,
} as const;

export function createAgenticPayQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: queryStaleTimes.transactional,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : undefined;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function exposeQueryClientForDevtools(queryClient: QueryClient) {
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    window.__AGENTICPAY_QUERY_CLIENT__ = queryClient;
  }
}
