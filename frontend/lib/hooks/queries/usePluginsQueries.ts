"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { apiFetch } from "@/lib/queries/api";

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  source: string;
  status: "installed" | "enabled" | "disabled" | "error";
  compatibility: unknown;
  health: { status?: string; errorCount?: number; lastError?: string };
  installedAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export function usePluginsQuery() {
  return useQuery({
    queryKey: queryKeys.plugins.lists(),
    queryFn: () => apiFetch<PluginRecord[]>("/api/v1/admin/plugins"),
    staleTime: 15_000,
  });
}

export function useInstallPluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      version: string;
      source: string;
      compatibility?: { agenticPay?: string; node?: string };
      config?: Record<string, unknown>;
    }) =>
      apiFetch<PluginRecord>("/api/v1/admin/plugins", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all() });
    },
  });
}

export function usePluginActionMutation(action: "enable" | "disable" | "remove") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) => {
      if (action === "remove") {
        return apiFetch<PluginRecord>(`/api/v1/admin/plugins/${pluginId}`, { method: "DELETE" });
      }
      return apiFetch<PluginRecord>(`/api/v1/admin/plugins/${pluginId}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "disable" ? { reason: "Disabled from admin UI" } : {}),
      });
    },
    onMutate: async (pluginId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.plugins.lists() });
      const previous = queryClient.getQueryData<PluginRecord[]>(queryKeys.plugins.lists());
      queryClient.setQueryData<PluginRecord[]>(queryKeys.plugins.lists(), (plugins = []) => {
        if (action === "remove") return plugins.filter((plugin) => plugin.id !== pluginId);
        return plugins.map((plugin) =>
          plugin.id === pluginId
            ? { ...plugin, status: action === "enable" ? "enabled" : "disabled" }
            : plugin
        );
      });
      return { previous };
    },
    onError: (_error, _pluginId, context) => {
      queryClient.setQueryData(queryKeys.plugins.lists(), context?.previous ?? []);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all() });
    },
  });
}
