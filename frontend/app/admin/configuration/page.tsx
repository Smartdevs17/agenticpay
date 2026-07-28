'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, History, RefreshCw, Save, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };

interface ResolvedConfig {
  key: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue: ConfigValue;
  value: ConfigValue;
  source: 'default' | 'environment' | 'database' | 'runtime';
  version?: number;
  updatedAt?: string;
}

interface AuditEntry {
  id: string;
  key: string;
  oldValue: ConfigValue | null;
  newValue: ConfigValue | null;
  actor: string | null;
  reason: string | null;
  source: string;
  requestId: string | null;
  createdAt: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

function formatValue(value: ConfigValue): string {
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

function parseValue(raw: string, type: ResolvedConfig['type']): ConfigValue {
  if (type === 'boolean') return raw === 'true';
  if (type === 'number') return Number(raw);
  if (type === 'object' || type === 'array') return JSON.parse(raw);
  return raw;
}

export default function ConfigurationAdminPage() {
  const [configs, setConfigs] = useState<ResolvedConfig[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Admin configuration update');
  const [importJson, setImportJson] = useState('{}');
  const [status, setStatus] = useState<string>('');

  const bySource = useMemo(() => {
    return configs.reduce<Record<string, number>>((acc, item) => {
      acc[item.source] = (acc[item.source] ?? 0) + 1;
      return acc;
    }, {});
  }, [configs]);

  async function load() {
    setStatus('Loading configuration...');
    const [configResponse, auditResponse] = await Promise.all([
      fetch(`${API_BASE}/api/v1/admin/configuration`, { cache: 'no-store' }),
      fetch(`${API_BASE}/api/v1/admin/configuration/audit`, { cache: 'no-store' }),
    ]);
    const configPayload = await configResponse.json();
    const auditPayload = await auditResponse.json();
    setConfigs(configPayload.data ?? []);
    setDrafts(
      Object.fromEntries((configPayload.data ?? []).map((item: ResolvedConfig) => [item.key, formatValue(item.value)]))
    );
    setAudit(auditPayload.data ?? []);
    setStatus('');
  }

  async function save(item: ResolvedConfig) {
    setStatus(`Saving ${item.key}...`);
    const response = await fetch(`${API_BASE}/api/v1/admin/configuration/${encodeURIComponent(item.key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: parseValue(drafts[item.key], item.type),
        reason,
        expectedVersion: item.version,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setStatus(payload.error?.message ?? 'Save failed');
      return;
    }
    await load();
  }

  async function exportConfig() {
    const response = await fetch(`${API_BASE}/api/v1/admin/configuration/export`, { cache: 'no-store' });
    const payload = await response.json();
    setImportJson(JSON.stringify(payload.values ?? {}, null, 2));
    setStatus('Export copied into the import editor.');
  }

  async function importConfig() {
    setStatus('Importing configuration...');
    const response = await fetch(`${API_BASE}/api/v1/admin/configuration/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: JSON.parse(importJson), reason }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setStatus(payload.error?.message ?? 'Import failed');
      return;
    }
    await load();
  }

  useEffect(() => {
    load().catch((error) => setStatus(error instanceof Error ? error.message : 'Failed to load configuration'));
  }, []);

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Configuration</h1>
            <p className="mt-1 text-sm text-muted-foreground">Centralized runtime configuration with audited updates.</p>
          </div>
          <div className="flex items-center gap-2">
            {Object.entries(bySource).map(([source, count]) => (
              <Badge key={source} variant="secondary">
                {source}: {count}
              </Badge>
            ))}
            <Button type="button" variant="outline" size="icon" onClick={() => load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="values">
          <TabsList>
            <TabsTrigger value="values">Values</TabsTrigger>
            <TabsTrigger value="migration">Import/Export</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="values" className="mt-4">
            <div className="mb-4 max-w-xl">
              <Input value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Change reason" />
            </div>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th className="p-3 font-medium">Key</th>
                    <th className="p-3 font-medium">Value</th>
                    <th className="p-3 font-medium">Source</th>
                    <th className="p-3 font-medium">Version</th>
                    <th className="w-16 p-3" />
                  </tr>
                </thead>
                <tbody>
                  {configs.map((item) => (
                    <tr key={item.key} className="border-t align-top">
                      <td className="max-w-xs p-3">
                        <div className="font-medium">{item.key}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
                      </td>
                      <td className="p-3">
                        {item.type === 'object' || item.type === 'array' ? (
                          <textarea
                            value={drafts[item.key] ?? ''}
                            onChange={(event) => setDrafts((current) => ({ ...current, [item.key]: event.target.value }))}
                            className="min-h-24 w-full rounded-md border bg-background p-2 font-mono text-xs"
                          />
                        ) : (
                          <Input
                            value={drafts[item.key] ?? ''}
                            onChange={(event) => setDrafts((current) => ({ ...current, [item.key]: event.target.value }))}
                          />
                        )}
                      </td>
                      <td className="p-3">
                        <Badge variant={item.source === 'runtime' ? 'default' : 'secondary'}>{item.source}</Badge>
                      </td>
                      <td className="p-3">{item.version ?? '-'}</td>
                      <td className="p-3">
                        <Button type="button" size="icon" onClick={() => save(item)}>
                          <Save className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="migration" className="mt-4">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={exportConfig}>
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
              <Button type="button" onClick={importConfig}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            </div>
            <textarea
              value={importJson}
              onChange={(event) => setImportJson(event.target.value)}
              className="mt-4 min-h-96 w-full rounded-md border bg-background p-3 font-mono text-xs"
            />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th className="p-3 font-medium">When</th>
                    <th className="p-3 font-medium">Key</th>
                    <th className="p-3 font-medium">Actor</th>
                    <th className="p-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id} className="border-t">
                      <td className="p-3">{new Date(entry.createdAt).toLocaleString()}</td>
                      <td className="p-3 font-medium">{entry.key}</td>
                      <td className="p-3">{entry.actor ?? '-'}</td>
                      <td className="p-3">{entry.reason ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <History className="h-4 w-4" />
              {audit.length} audited changes
            </div>
          </TabsContent>
        </Tabs>

        {status ? <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">{status}</div> : null}
      </div>
    </main>
  );
}
