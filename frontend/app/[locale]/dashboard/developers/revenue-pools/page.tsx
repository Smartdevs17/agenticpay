'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { api, RevenuePool, RevenueRecipient, RevenueDistribution } from '@/lib/api';
import { toast } from 'sonner';
import { Plus, Trash2, PieChart, History, Wallet, ArrowUpRight } from 'lucide-react';

export default function RevenuePoolsPage() {
  const [pools, setPools] = useState<RevenuePool[]>([]);
  const [recipients, setRecipients] = useState<Record<string, RevenueRecipient[]>>({});
  const [balances, setBalances] = useState<Record<string, Record<string, string>>>({});
  const [distributions, setDistributions] = useState<Record<string, RevenueDistribution[]>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [addRecipientOpen, setAddRecipientOpen] = useState<string | null>(null);
  const [newPool, setNewPool] = useState({ name: '', chain: 'soroban' as const, contractId: '' });
  const [newRecipient, setNewRecipient] = useState({ address: '', ratio: 0 });

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await api.revenuePools.listPools();
      setPools(res.pools);
      const recMap: Record<string, RevenueRecipient[]> = {};
      const balMap: Record<string, Record<string, string>> = {};
      const distMap: Record<string, RevenueDistribution[]> = {};
      for (const pool of res.pools) {
        try {
          const [recRes, balRes, distRes] = await Promise.all([
            api.revenuePools.getPool(pool.id),
            api.revenuePools.getBalances(pool.id),
            api.revenuePools.listDistributions(pool.id),
          ]);
          if ('recipients' in recRes) recMap[pool.id] = (recRes as any).recipients;
          balMap[pool.id] = balRes.balances || {};
          distMap[pool.id] = distRes.distributions || [];
        } catch {}
      }
      setRecipients(recMap);
      setBalances(balMap);
      setDistributions(distMap);
    } catch {
      toast.error('Failed to load revenue pools');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCreate = async () => {
    try {
      const pool = await api.revenuePools.createPool(newPool);
      setPools(p => [...p, pool]);
      setCreateOpen(false);
      setNewPool({ name: '', chain: 'soroban', contractId: '' });
      toast.success('Revenue pool created');
    } catch {
      toast.error('Failed to create pool');
    }
  };

  const handleAddRecipient = async (poolId: string) => {
    try {
      await api.revenuePools.addRecipient(poolId, newRecipient);
      setAddRecipientOpen(null);
      setNewRecipient({ address: '', ratio: 0 });
      toast.success('Recipient added');
      loadData();
    } catch {
      toast.error('Failed to add recipient');
    }
  };

  const handleRemoveRecipient = async (poolId: string, recipientId: string) => {
    try {
      await api.revenuePools.removeRecipient(poolId, recipientId);
      toast.success('Recipient removed');
      loadData();
    } catch {
      toast.error('Failed to remove recipient');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Revenue Pools</h1>
          <p className="text-muted-foreground text-sm">Manage smart contract-driven revenue sharing pools</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Create Pool
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Revenue Pool</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={newPool.name} onChange={e => setNewPool(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <Label>Chain</Label>
                <Select value={newPool.chain} onValueChange={v => setNewPool(p => ({ ...p, chain: v as 'soroban' | 'evm' }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="soroban">Soroban</SelectItem>
                    <SelectItem value="evm">EVM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Contract ID</Label>
                <Input value={newPool.contractId} onChange={e => setNewPool(p => ({ ...p, contractId: e.target.value }))} />
              </div>
              <Button className="w-full" onClick={handleCreate}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : pools.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <PieChart className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p className="font-medium">No revenue pools yet</p>
          <p className="text-sm">Create your first pool to start splitting revenue automatically.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {pools.map(pool => (
            <Card key={pool.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{pool.name}</CardTitle>
                  <div className="flex gap-2 mt-1">
                    <Badge variant={pool.chain === 'evm' ? 'default' : 'secondary'}>{pool.chain}</Badge>
                    <Badge variant={pool.status === 'active' ? 'outline' : 'secondary'}>{pool.status}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Dialog open={addRecipientOpen === pool.id} onOpenChange={o => setAddRecipientOpen(o ? pool.id : null)}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Plus className="mr-1 h-3 w-3" /> Add Recipient
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Recipient</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Wallet Address</Label>
                          <Input value={newRecipient.address} onChange={e => setNewRecipient(r => ({ ...r, address: e.target.value }))} />
                        </div>
                        <div>
                          <Label>Ratio (basis points)</Label>
                          <Input type="number" value={newRecipient.ratio} onChange={e => setNewRecipient(r => ({ ...r, ratio: parseInt(e.target.value) || 0 }))} />
                        </div>
                        <Button className="w-full" onClick={() => handleAddRecipient(pool.id)}>Add</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Wallet className="h-4 w-4" /> Recipients & Splits
                    </h4>
                    {(recipients[pool.id] || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recipients configured</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex h-2 rounded-full bg-muted overflow-hidden">
                          {(recipients[pool.id] || []).map((r, i) => (
                            <div
                              key={r.id}
                              className="h-full"
                              style={{
                                width: `${r.ratio}%`,
                                backgroundColor: `hsl(${(i * 60 + 200) % 360}, 70%, 55%)`,
                              }}
                            />
                          ))}
                        </div>
                        <div className="space-y-2">
                          {(recipients[pool.id] || []).map((r, i) => (
                            <div key={r.id} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `hsl(${(i * 60 + 200) % 360}, 70%, 55%)` }} />
                                <span className="font-mono text-xs">{r.address.slice(0, 8)}...{r.address.slice(-4)}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-muted-foreground">{r.ratio}%</span>
                                <span className="font-mono text-xs">{balances[pool.id]?.[r.address] || '0'}</span>
                                <button onClick={() => handleRemoveRecipient(pool.id, r.id)} className="text-destructive hover:text-destructive/80">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <History className="h-4 w-4" /> Recent Distributions
                    </h4>
                    {(distributions[pool.id] || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No distributions yet</p>
                    ) : (
                      <div className="space-y-1">
                        {(distributions[pool.id] || []).slice(0, 5).map(d => (
                          <div key={d.id} className="flex items-center justify-between text-sm">
                            <span className="font-mono text-xs">{d.txHash.slice(0, 12)}...</span>
                            <div className="flex items-center gap-2">
                              <Badge variant={d.status === 'completed' ? 'outline' : 'secondary'} className="text-xs">
                                {d.status}
                              </Badge>
                              <span className="font-mono text-xs">{d.amount}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
