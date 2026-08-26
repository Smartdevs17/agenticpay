'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { apiCall } from '@/lib/api/client';

interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  tier: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'revoked' | 'expired';
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiKeyUsage {
  keyId: string;
  keyName: string;
  tier: string;
  totalRequests: number;
  blockedRequests: number;
  allowRate: number;
  lastUsedAt: string | null;
}

const tierColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  pro: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  revoked: 'bg-red-100 text-red-700',
  expired: 'bg-yellow-100 text-yellow-700',
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [usage, setUsage] = useState<ApiKeyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<{ record: ApiKeyRecord; rawKey: string } | null>(null);
  const [form, setForm] = useState({ name: '', tier: 'free', expiresInDays: '' });

  const fetchData = async () => {
    try {
      const [keysRes, usageRes] = await Promise.all([
        apiCall<{ data: ApiKeyRecord[] }>('/api-keys'),
        apiCall<{ data: ApiKeyUsage[] }>('/api-keys/usage'),
      ]);
      setKeys(keysRes.data);
      setUsage(usageRes.data);
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiCall<{ data: ApiKeyRecord; rawKey: string }>('/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          tier: form.tier,
          expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : undefined,
        }),
      });
      setNewKey(res);
      setShowCreate(false);
      setForm({ name: '', tier: 'free', expiresInDays: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to create API key:', err);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this API key? This action cannot be undone.')) return;
    try {
      await apiCall(`/api-keys/${id}/revoke`, { method: 'POST' });
      fetchData();
    } catch (err) {
      console.error('Failed to revoke:', err);
    }
  };

  const handleRotate = async (id: string) => {
    try {
      const res = await apiCall<{ data: ApiKeyRecord; rawKey: string }>(`/api-keys/${id}/rotate`, {
        method: 'POST',
      });
      setNewKey(res);
      fetchData();
    } catch (err) {
      console.error('Failed to rotate:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this API key?')) return;
    try {
      await apiCall(`/api-keys/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">Loading API keys...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your API keys and monitor usage analytics.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>Create API Key</Button>
      </div>

      {newKey && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-800 text-base">API Key Created</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-green-700">Store this key securely. It will not be shown again.</p>
            <code className="block p-3 bg-white rounded border text-sm font-mono break-all">{newKey.rawKey}</code>
            <Button variant="outline" size="sm" onClick={() => setNewKey(null)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create New API Key</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="My API Key" />
                </div>
                <div className="space-y-1">
                  <Label>Tier</Label>
                  <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-background">
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Expires In (days, optional)</Label>
                  <Input type="number" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} placeholder="90" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit">Create</Button>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage Analytics</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage data yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {usage.map((u) => (
                <div key={u.keyId} className="p-3 border rounded space-y-1">
                  <p className="font-medium text-sm">{u.keyName}</p>
                  <p className="text-xs text-muted-foreground">Tier: {u.tier}</p>
                  <p className="text-sm">Total: <span className="font-mono">{u.totalRequests}</span></p>
                  <p className="text-sm">Blocked: <span className="font-mono text-red-600">{u.blockedRequests}</span></p>
                  <p className="text-sm">Allow Rate: <span className="font-mono">{(u.allowRate * 100).toFixed(1)}%</span></p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All API Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet. Create one to get started.</p>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between p-3 border rounded">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{key.name}</span>
                      <Badge className={tierColors[key.tier]}>{key.tier}</Badge>
                      <Badge className={statusColors[key.status]}>{key.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{key.keyPrefix}</p>
                    <p className="text-xs text-muted-foreground">
                      Created: {new Date(key.createdAt).toLocaleDateString()}
                      {key.lastUsedAt && ` | Last used: ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {key.status === 'active' && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleRotate(key.id)}>Rotate</Button>
                        <Button variant="outline" size="sm" onClick={() => handleRevoke(key.id)}>Revoke</Button>
                      </>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(key.id)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
