"use client";

import { useState } from "react";
import { CheckCircle2, PauseCircle, PlayCircle, Plus, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useInstallPluginMutation,
  usePluginActionMutation,
  usePluginsQuery,
} from "@/lib/hooks/queries/usePluginsQueries";

export default function PluginsAdminPage() {
  const pluginsQuery = usePluginsQuery();
  const installPlugin = useInstallPluginMutation();
  const enablePlugin = usePluginActionMutation("enable");
  const disablePlugin = usePluginActionMutation("disable");
  const removePlugin = usePluginActionMutation("remove");
  const [form, setForm] = useState({
    name: "",
    version: "0.1.0",
    source: "",
    agenticPay: "^0.1.0",
    configJson: "{}",
  });

  const plugins = pluginsQuery.data ?? [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Plugins</h1>
        </div>
      </div>

      <form
        className="grid gap-3 rounded-md border bg-background p-4 md:grid-cols-[1fr_120px_1.5fr_120px_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          let config: Record<string, unknown>;
          try {
            config = JSON.parse(form.configJson || "{}") as Record<string, unknown>;
          } catch {
            return;
          }
          installPlugin.mutate({
            name: form.name,
            version: form.version,
            source: form.source,
            compatibility: { agenticPay: form.agenticPay },
            config,
          });
        }}
      >
        <Input
          aria-label="Plugin name"
          placeholder="fee-optimizer"
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
        <Input
          aria-label="Version"
          placeholder="0.1.0"
          value={form.version}
          onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))}
        />
        <Input
          aria-label="Plugin source path"
          placeholder="/srv/agenticpay/plugins/fee-optimizer.js"
          value={form.source}
          onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}
        />
        <Input
          aria-label="Compatibility"
          placeholder="^0.1.0"
          value={form.agenticPay}
          onChange={(event) => setForm((current) => ({ ...current, agenticPay: event.target.value }))}
        />
        <Input
          aria-label="Config JSON"
          placeholder="{}"
          value={form.configJson}
          onChange={(event) => setForm((current) => ({ ...current, configJson: event.target.value }))}
        />
        <Button type="submit" disabled={installPlugin.isPending || !form.name || !form.source}>
          <Plus className="mr-2 h-4 w-4" />
          Install
        </Button>
      </form>

      <section className="overflow-x-auto rounded-md border">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[1.2fr_90px_110px_1fr_160px] border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
            <span>Name</span>
            <span>Version</span>
            <span>Status</span>
            <span>Health</span>
            <span className="text-right">Actions</span>
          </div>

          {pluginsQuery.isLoading ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">Loading plugins...</div>
          ) : plugins.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">No plugins installed.</div>
          ) : (
            plugins.map((plugin) => (
              <div
                key={plugin.id}
                className="grid grid-cols-[1.2fr_90px_110px_1fr_160px] items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{plugin.name}</div>
                <div className="truncate text-xs text-muted-foreground">{plugin.source}</div>
              </div>
              <div className="text-sm">{plugin.version}</div>
              <div className="flex items-center gap-2 text-sm">
                {plugin.status === "enabled" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : plugin.status === "error" ? (
                  <XCircle className="h-4 w-4 text-red-600" />
                ) : (
                  <PauseCircle className="h-4 w-4 text-muted-foreground" />
                )}
                {plugin.status}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {plugin.health?.lastError ?? plugin.health?.status ?? "unknown"}
              </div>
              <div className="flex justify-end gap-2">
                {plugin.status === "enabled" ? (
                  <Button size="icon" variant="outline" aria-label="Disable plugin" onClick={() => disablePlugin.mutate(plugin.id)}>
                    <PauseCircle className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="icon" variant="outline" aria-label="Enable plugin" onClick={() => enablePlugin.mutate(plugin.id)}>
                    <PlayCircle className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="outline" aria-label="Remove plugin" onClick={() => removePlugin.mutate(plugin.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
