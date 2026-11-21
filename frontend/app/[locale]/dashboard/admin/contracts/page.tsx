'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Clock, Pause, Play, RefreshCw, Shield, ShieldAlert, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiCall } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface PauseRecord {
  id: string;
  chain: 'evm' | 'soroban';
  contractAddress: string;
  pauseImplementation: string;
  status: 'pending' | 'active' | 'expired' | 'resolved';
  requestedBy: string;
  requestedAt: number;
  activatedAt?: number;
  expiresAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  approvals: Record<string, number>;
  threshold: number;
  timeoutSeconds: number;
}

interface Guardian {
  address: string;
  chain: 'evm' | 'soroban';
  active: boolean;
  addedAt: number;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  active: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
  resolved: 'bg-emerald-100 text-emerald-800',
};

const STATUS_ICONS: Record<string, typeof Pause> = {
  pending: Clock,
  active: ShieldAlert,
  expired: AlertTriangle,
  resolved: CheckCircle,
};

function formatTimeRemaining(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m remaining`;
}

export default function AdminContractsPausePage() {
  const [records, setRecords] = useState<PauseRecord[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddGuardian, setShowAddGuardian] = useState(false);
  const [newGuardianAddress, setNewGuardianAddress] = useState('');
  const [newGuardianChain, setNewGuardianChain] = useState<'evm' | 'soroban'>('evm');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pauseRes, guardianRes] = await Promise.all([
        apiCall<{ records: PauseRecord[]; total: number }>('/admin/contracts/pause', { method: 'GET' }),
        apiCall<{ guardians: Guardian[] }>('/admin/contracts/pause/guardians/list', { method: 'GET' }),
      ]);
      setRecords(pauseRes.records);
      setGuardians(guardianRes.guardians);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load pause state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const resolve = async (pauseId: string) => {
    try {
      await apiCall(`/admin/contracts/pause/${pauseId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolvedBy: 'admin' }),
      });
      toast.success('Pause resolved');
      void load();
    } catch (error) {
      console.error(error);
      toast.error('Failed to resolve pause');
    }
  };

  const checkExpiry = async () => {
    try {
      const result = await apiCall<{ count: number }>('/admin/contracts/pause/check-expiry', { method: 'POST' });
      toast.success(`Checked expiry: ${result.count} pauses expired`);
      void load();
    } catch (error) {
      console.error(error);
      toast.error('Failed to check expiry');
    }
  };

  const addGuardian = async () => {
    if (!newGuardianAddress) return;
    try {
      await apiCall('/admin/contracts/pause/guardians', {
        method: 'POST',
        body: JSON.stringify({ address: newGuardianAddress, chain: newGuardianChain }),
      });
      toast.success('Guardian added');
      setNewGuardianAddress('');
      setShowAddGuardian(false);
      void load();
    } catch (error) {
      console.error(error);
      toast.error('Failed to add guardian');
    }
  };

  const removeGuardian = async (address: string) => {
    try {
      await apiCall(`/admin/contracts/pause/guardians/${encodeURIComponent(address)}`, { method: 'DELETE' });
      toast.success('Guardian deactivated');
      void load();
    } catch (error) {
      console.error(error);
      toast.error('Failed to remove guardian');
    }
  };

  const activeCount = records.filter((r) => r.status === 'active').length;
  const pendingCount = records.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950 dark:text-white">Contract Pause Dashboard</h1>
          <div className="mt-2 flex items-center gap-2">
            {activeCount > 0 ? (
              <Badge className="bg-red-100 text-red-800">
                <ShieldAlert className="mr-1 h-3 w-3" />
                {activeCount} Active Pause{activeCount > 1 ? 's' : ''}
              </Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-800">
                <Shield className="mr-1 h-3 w-3" />
                All Clear
              </Badge>
            )}
            {pendingCount > 0 && (
              <Badge className="bg-yellow-100 text-yellow-800">
                <Clock className="mr-1 h-3 w-3" />
                {pendingCount} Pending
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">{records.length} total records</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={checkExpiry}>
            <Clock className="mr-2 h-4 w-4" />
            Check Expiry
          </Button>
        </div>
      </div>

      {/* Pause Records */}
      <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Chain</th>
              <th className="px-4 py-3 font-medium">Contract</th>
              <th className="px-4 py-3 font-medium">Approvals</th>
              <th className="px-4 py-3 font-medium">Timeout</th>
              <th className="px-4 py-3 font-medium">Requested</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const StatusIcon = STATUS_ICONS[record.status] ?? Clock;
              return (
                <tr key={record.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-4 py-3">
                    <Badge className={STATUS_STYLES[record.status]}>
                      <StatusIcon className="mr-1 h-3 w-3" />
                      {record.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{record.chain.toUpperCase()}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{record.contractAddress}</td>
                  <td className="px-4 py-3">
                    {Object.keys(record.approvals).length}/{record.threshold}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {record.status === 'active' && record.expiresAt
                      ? formatTimeRemaining(record.expiresAt)
                      : `${Math.round(record.timeoutSeconds / 3600)}h`}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {new Date(record.requestedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {record.status === 'active' && (
                      <Button size="sm" variant="outline" onClick={() => resolve(record.id)}>
                        <Play className="mr-1 h-3 w-3" />
                        Resume
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && records.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">No pause records found</div>
        )}
      </div>

      {/* Guardian Management */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-950 dark:text-white">Guardians</h2>
          <Button variant="outline" size="sm" onClick={() => setShowAddGuardian(!showAddGuardian)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Guardian
          </Button>
        </div>

        {showAddGuardian && (
          <div className="flex items-end gap-3 rounded-md border border-gray-200 p-4 dark:border-gray-800">
            <div className="flex-1 space-y-2">
              <Label htmlFor="guardian-address">Address</Label>
              <Input
                id="guardian-address"
                value={newGuardianAddress}
                onChange={(e) => setNewGuardianAddress(e.target.value)}
                placeholder="0x... or G..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guardian-chain">Chain</Label>
              <select
                id="guardian-chain"
                className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-950"
                value={newGuardianChain}
                onChange={(e) => setNewGuardianChain(e.target.value as 'evm' | 'soroban')}
              >
                <option value="evm">EVM</option>
                <option value="soroban">Soroban</option>
              </select>
            </div>
            <Button onClick={addGuardian}>Add</Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 text-left text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Chain</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Added</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {guardians.map((g) => (
                <tr key={g.address} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-4 py-3 font-mono text-xs">{g.address}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{g.chain.toUpperCase()}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={g.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'}>
                      {g.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">{new Date(g.addedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {g.active && (
                      <Button size="sm" variant="ghost" onClick={() => removeGuardian(g.address)}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {guardians.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No guardians configured</div>
          )}
        </div>
      </div>
    </div>
  );
}
