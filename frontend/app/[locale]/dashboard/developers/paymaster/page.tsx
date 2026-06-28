'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, PaymasterBudget, UserOperation } from '@/lib/api';
import { toast } from 'sonner';
import { Wallet, RefreshCw, Activity, Fuel, ArrowUpRight, CheckCircle, XCircle, Clock } from 'lucide-react';

export default function PaymasterPage() {
  const [budgets, setBudgets] = useState<PaymasterBudget[]>([]);
  const [operations, setOperations] = useState<UserOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [topUpOpen, setTopUpOpen] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [budgetsRes, opsRes] = await Promise.all([
        api.paymaster.listBudgets(),
        api.paymaster.listOperations(),
      ]);
      setBudgets(budgetsRes.budgets);
      setOperations(opsRes.operations);
    } catch {
      toast.error('Failed to load paymaster data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleTopUp = async (budgetId: string) => {
    try {
      await api.paymaster.topUp(budgetId, { token: 'native', amount: topUpAmount });
      setTopUpOpen(null);
      setTopUpAmount('');
      toast.success('Budget topped up');
      loadData();
    } catch {
      toast.error('Failed to top up budget');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Paymaster & Account Abstraction</h1>
        <p className="text-muted-foreground text-sm">Manage ERC-4337 paymaster budgets and user operations</p>
      </div>

      <Tabs defaultValue="budgets">
        <TabsList>
          <TabsTrigger value="budgets"><Wallet className="mr-2 h-4 w-4" /> Budgets</TabsTrigger>
          <TabsTrigger value="operations"><Activity className="mr-2 h-4 w-4" /> Operations</TabsTrigger>
        </TabsList>

        <TabsContent value="budgets" className="space-y-4 mt-4">
          {loading ? (
            <div className="text-center text-muted-foreground py-12">Loading...</div>
          ) : budgets.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Fuel className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">No paymaster budgets</p>
              <p className="text-sm">Budgets appear once user operations are submitted.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {budgets.map(b => (
                <Card key={b.id}>
                  <CardHeader className="flex flex-row items-center justify-between py-4">
                    <div>
                      <CardTitle className="text-sm font-medium">
                        Chain {b.chainId} — {b.token}
                      </CardTitle>
                    </div>
                    <Dialog open={topUpOpen === b.id} onOpenChange={o => setTopUpOpen(o ? b.id : null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <ArrowUpRight className="mr-1 h-3 w-3" /> Top Up
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Top Up Budget</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label>Amount (wei)</Label>
                            <Input type="number" value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} />
                          </div>
                          <Button className="w-full" onClick={() => handleTopUp(b.id)}>Deposit</Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground block">Balance</span>
                        <span className="font-mono">{b.balance}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Total Deposited</span>
                        <span className="font-mono">{b.totalDeposited}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Total Used</span>
                        <span className="font-mono">{b.totalUsed}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Max Gas/Tx</span>
                        <span className="font-mono">{b.maxGasPerTx || 'unlimited'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="operations" className="space-y-4 mt-4">
          {loading ? (
            <div className="text-center text-muted-foreground py-12">Loading...</div>
          ) : operations.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Activity className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">No user operations yet</p>
              <p className="text-sm">Operations appear when users submit sponsored transactions.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {operations.map(op => (
                <Card key={op.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        {op.status === 'completed' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : op.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-yellow-500" />
                        )}
                        <span className="font-mono text-xs">{op.userOpHash.slice(0, 16)}...</span>
                        <Badge variant="outline" className="text-xs">{op.mode}</Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground text-xs">{op.sender.slice(0, 8)}...</span>
                        {op.txHash && <span className="font-mono text-xs">{op.txHash.slice(0, 10)}...</span>}
                        <Badge variant={op.status === 'completed' ? 'outline' : op.status === 'failed' ? 'destructive' : 'secondary'} className="text-xs">
                          {op.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
