export const queryKeys = {
  all: ['agenticpay'] as const,
  payments: {
    all: () => [...queryKeys.all, 'payments'] as const,
    lists: () => [...queryKeys.payments.all(), 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.payments.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.payments.all(), 'detail', id] as const,
    infinite: (filters: Record<string, unknown> = {}) => [...queryKeys.payments.lists(), 'infinite', filters] as const,
  },
  invoices: {
    all: () => [...queryKeys.all, 'invoices'] as const,
    lists: () => [...queryKeys.invoices.all(), 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.invoices.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.invoices.all(), 'detail', id] as const,
  },
  webhooks: {
    all: () => [...queryKeys.all, 'webhooks'] as const,
    lists: () => [...queryKeys.webhooks.all(), 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.webhooks.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.webhooks.all(), 'detail', id] as const,
  },
  disputes: {
    all: () => [...queryKeys.all, 'disputes'] as const,
    lists: () => [...queryKeys.disputes.all(), 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.disputes.lists(), filters] as const,
    infinite: (filters: Record<string, unknown> = {}) => [...queryKeys.disputes.lists(), 'infinite', filters] as const,
    detail: (id: string) => [...queryKeys.disputes.all(), 'detail', id] as const,
  },
  plugins: {
    all: () => [...queryKeys.all, 'plugins'] as const,
    lists: () => [...queryKeys.plugins.all(), 'list'] as const,
    audit: (pluginId?: string) => [...queryKeys.plugins.all(), 'audit', pluginId ?? 'all'] as const,
  },
  twoFactor: {
    status: (userId: string) => [...queryKeys.all, '2fa', 'status', userId] as const,
    logs: (userId: string, limit: number, offset: number) =>
      [...queryKeys.all, '2fa', 'logs', userId, limit, offset] as const,
  },
} as const;
