"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const tenantId = 't_123';

interface ApiKeyUsage {
  id: string;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  recordedAt: string;
}

interface UsageSummary {
  keyId: string;
  hourlyCount: number;
  dailyCount: number;
  hourlyLimit: number;
  dailyLimit: number;
  usage: ApiKeyUsage[];
}

interface ApiKey {
  keyId: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { usage: number };
  quota: { requestsPerHour: number; requestsPerDay: number } | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [description, setDescription] = useState('');

  const loadKeys = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/developers/api-keys', {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      console.error('Failed to load API keys');
    }
    setIsLoading(false);
  };

  const loadUsage = async (keyId: string) => {
    try {
      const res = await fetch(`/api/v1/developers/api-keys/${keyId}/usage`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      setUsageSummary(data);
      setSelectedKey(keyId);
    } catch {
      console.error('Failed to load usage');
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreate = async () => {
    try {
      await fetch('/api/v1/developers/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ description }),
      });
      setShowCreate(false);
      setDescription('');
      loadKeys();
    } catch {
      console.error('Failed to create key');
    }
  };

  const handleDelete = async (keyId: string) => {
    try {
      await fetch(`/api/v1/developers/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: { 'x-tenant-id': tenantId },
      });
      loadKeys();
      if (selectedKey === keyId) {
        setSelectedKey(null);
        setUsageSummary(null);
      }
    } catch {
      console.error('Failed to delete key');
    }
  };

  const usagePercent = (summary: UsageSummary) => {
    const hourlyPct = Math.round((summary.hourlyCount / summary.hourlyLimit) * 100);
    const dailyPct = Math.round((summary.dailyCount / summary.dailyLimit) * 100);
    return { hourlyPct, dailyPct };
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 text-gray-900">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">API Key Usage & Analytics</h1>
            <p className="text-gray-500 mt-1">Monitor and manage your API key consumption</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button>Create API Key</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API Key</DialogTitle>
                <DialogDescription>Give your key a descriptive name</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Description</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Production key" />
                </div>
                <Button onClick={handleCreate} className="w-full">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">API Keys</CardTitle>
                <CardDescription>{keys.length} active keys</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-gray-500">Loading...</p>
                ) : keys.length === 0 ? (
                  <p className="text-sm text-gray-500">No API keys yet</p>
                ) : (
                  <div className="space-y-2">
                    {keys.map((key) => (
                      <button
                        key={key.keyId}
                        onClick={() => loadUsage(key.keyId)}
                        className={`w-full p-3 rounded-lg border text-left transition ${
                          selectedKey === key.keyId
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-medium text-sm truncate">{key.description || key.keyId}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {key._count.usage} requests
                          {!key.isActive && <Badge variant="destructive" className="ml-2">Revoked</Badge>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="col-span-2 space-y-6">
            {selectedKey && usageSummary ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Hourly Usage</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">{usageSummary.hourlyCount}</div>
                      <div className="text-sm text-gray-500">of {usageSummary.hourlyLimit} limit</div>
                      <div className="mt-2 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition ${
                            usagePercent(usageSummary).hourlyPct > 80
                              ? 'bg-red-500'
                              : usagePercent(usageSummary).hourlyPct > 50
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(usagePercent(usageSummary).hourlyPct, 100)}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Daily Usage</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">{usageSummary.dailyCount}</div>
                      <div className="text-sm text-gray-500">of {usageSummary.dailyLimit} limit</div>
                      <div className="mt-2 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition ${
                            usagePercent(usageSummary).dailyPct > 80
                              ? 'bg-red-500'
                              : usagePercent(usageSummary).dailyPct > 50
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(usagePercent(usageSummary).dailyPct, 100)}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-lg">Recent Requests</CardTitle>
                      <Button size="sm" variant="outline" onClick={() => handleDelete(selectedKey)}>Revoke Key</Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {usageSummary.usage.length === 0 ? (
                      <p className="text-sm text-gray-500">No recent requests</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-gray-500">
                              <th className="pb-2 pr-4">Endpoint</th>
                              <th className="pb-2 pr-4">Method</th>
                              <th className="pb-2 pr-4">Status</th>
                              <th className="pb-2 pr-4">Latency</th>
                              <th className="pb-2">Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {usageSummary.usage.slice(0, 50).map((u) => (
                              <tr key={u.id} className="border-b border-gray-100">
                                <td className="py-2 pr-4 font-mono text-xs truncate max-w-[200px]">{u.endpoint}</td>
                                <td className="py-2 pr-4">
                                  <Badge variant="outline" className="text-xs">{u.method}</Badge>
                                </td>
                                <td className="py-2 pr-4">
                                  <span className={u.statusCode >= 400 ? 'text-red-600' : 'text-green-600'}>{u.statusCode}</span>
                                </td>
                                <td className="py-2 pr-4">{u.latencyMs}ms</td>
                                <td className="py-2 text-gray-500">{new Date(u.recordedAt).toLocaleTimeString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-gray-500">Select an API key to view its usage analytics</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
