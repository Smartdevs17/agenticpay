'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, CheckCircle2, Clock, Lock, Unlock, ShieldAlert, Plus } from 'lucide-react';

interface VaultMilestone {
  id: string;
  name: string;
  amountPercent: number;
  deadline: string;
  approverAddress: string;
  status: 'pending' | 'approved' | 'released' | 'expired' | 'disputed';
}

interface PaymentVault {
  id: string;
  depositorAddress: string;
  recipientAddress: string;
  totalAmount: string;
  currency: string;
  network: string;
  status: 'pending' | 'active' | 'disputed' | 'completed' | 'refunded';
  contractAddress?: string;
  milestones: VaultMilestone[];
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-800',
  active:    'bg-blue-100 text-blue-800',
  disputed:  'bg-red-100 text-red-800',
  completed: 'bg-green-100 text-green-800',
  refunded:  'bg-gray-100 text-gray-800',
};

const MILESTONE_STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  released: 'bg-green-100 text-green-700',
  expired:  'bg-gray-100 text-gray-700',
  disputed: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function MilestoneRow({ milestone, vaultId, onRefresh }: { milestone: VaultMilestone; vaultId: string; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);

  const approve = async () => {
    const approverAddress = prompt('Enter approver address:');
    if (!approverAddress) return;
    setLoading(true);
    try {
      await fetch(`/api/v1/vaults/milestones/${milestone.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approverAddress }),
      });
      onRefresh();
    } finally {
      setLoading(false);
    }
  };

  const release = async () => {
    const triggeredBy = prompt('Enter your address:');
    if (!triggeredBy) return;
    setLoading(true);
    try {
      await fetch(`/api/v1/vaults/milestones/${milestone.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy }),
      });
      onRefresh();
    } finally {
      setLoading(false);
    }
  };

  const deadline = new Date(milestone.deadline);
  const isPast = deadline < new Date();

  return (
    <div className="flex items-center justify-between py-3 border-b last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{milestone.name}</p>
        <p className="text-xs text-muted-foreground">
          {milestone.amountPercent}% · Due {deadline.toLocaleDateString()}
          {isPast && milestone.status === 'pending' && <span className="ml-1 text-red-500">(overdue)</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 ml-4">
        <Badge className={MILESTONE_STATUS_STYLES[milestone.status] ?? ''}>
          {milestone.status}
        </Badge>
        {milestone.status === 'pending' && (
          <Button size="sm" variant="outline" onClick={approve} disabled={loading}>
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Approve
          </Button>
        )}
        {milestone.status === 'approved' && (
          <Button size="sm" onClick={release} disabled={loading}>
            <Unlock className="h-3 w-3 mr-1" />
            Release
          </Button>
        )}
      </div>
    </div>
  );
}

function VaultCard({ vault, onRefresh }: { vault: PaymentVault; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [disputing, setDisputing] = useState(false);

  const releasedPercent = vault.milestones.reduce(
    (sum, m) => (m.status === 'released' ? sum + m.amountPercent : sum),
    0,
  );

  const raiseDispute = async () => {
    const raisedBy = prompt('Enter your address:');
    if (!raisedBy) return;
    setDisputing(true);
    try {
      await fetch(`/api/v1/vaults/${vault.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raisedBy }),
      });
      onRefresh();
    } finally {
      setDisputing(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold truncate">
              {vault.currency} {parseFloat(vault.totalAmount).toLocaleString()} · {vault.network}
            </CardTitle>
            <CardDescription className="text-xs mt-1 font-mono truncate">
              {vault.depositorAddress.slice(0, 8)}…{vault.depositorAddress.slice(-6)} →{' '}
              {vault.recipientAddress.slice(0, 8)}…{vault.recipientAddress.slice(-6)}
            </CardDescription>
          </div>
          <StatusBadge status={vault.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Released</span>
            <span>{releasedPercent}%</span>
          </div>
          <Progress value={releasedPercent} className="h-2" />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Hide milestones' : `Show ${vault.milestones.length} milestone(s)`}
          </Button>
          {vault.status === 'active' && (
            <Button variant="outline" size="sm" onClick={raiseDispute} disabled={disputing}>
              <ShieldAlert className="h-3 w-3 mr-1" />
              Dispute
            </Button>
          )}
        </div>

        {expanded && (
          <div className="border rounded-md px-3">
            {vault.milestones.map((m) => (
              <MilestoneRow key={m.id} milestone={m} vaultId={vault.id} onRefresh={onRefresh} />
            ))}
          </div>
        )}

        {vault.contractAddress && (
          <p className="text-xs text-muted-foreground mt-2 font-mono truncate">
            Contract: {vault.contractAddress}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function VaultsPage() {
  const [vaults, setVaults] = useState<PaymentVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVaults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/v1/vaults');
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
      const json = (await resp.json()) as { data: PaymentVault[] };
      setVaults(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchVaults();
  }, [fetchVaults]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Payment Vaults</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Time-locked escrow with milestone-based fund release
          </p>
        </div>
        <Button asChild>
          <a href="/dashboard/vaults/new">
            <Plus className="h-4 w-4 mr-2" />
            New Vault
          </a>
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-md bg-red-50 text-red-700 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse h-32" />
          ))}
        </div>
      )}

      {!loading && !error && vaults.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Lock className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">No payment vaults yet.</p>
            <Button className="mt-4" asChild>
              <a href="/dashboard/vaults/new">Create your first vault</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && vaults.map((vault) => (
        <VaultCard key={vault.id} vault={vault} onRefresh={fetchVaults} />
      ))}
    </div>
  );
}
