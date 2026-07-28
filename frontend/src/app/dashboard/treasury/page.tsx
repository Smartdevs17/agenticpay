"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const tenantId = 't_123';

interface Proposal {
  id: string;
  proposalId: string;
  proposer: string;
  description: string;
  target: string;
  amount: string;
  status: string;
  approvalCount: number;
  rejectionCount: number;
  threshold: number;
  executeAfter: string;
  createdAt: string;
  approvals: { id: string; signer: string; approved: boolean }[];
  execution: { txHash: string; executedBy: string; executedAt: string } | null;
}

export default function TreasuryPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPropose, setShowPropose] = useState(false);
  const [signerAddress, setSignerAddress] = useState('');

  const [form, setForm] = useState({
    proposer: '',
    description: '',
    target: '',
    amount: '',
    threshold: 2,
    timelockDelay: 3600,
  });

  const loadProposals = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/treasury/proposals', {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      setProposals(data.proposals ?? []);
    } catch {
      console.error('Failed to load proposals');
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadProposals();
  }, []);

  const handlePropose = async () => {
    try {
      await fetch('/api/v1/treasury/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(form),
      });
      setShowPropose(false);
      setForm({ proposer: '', description: '', target: '', amount: '', threshold: 2, timelockDelay: 3600 });
      loadProposals();
    } catch {
      console.error('Failed to create proposal');
    }
  };

  const handleApprove = async (id: string) => {
    if (!signerAddress) return;
    try {
      await fetch(`/api/v1/treasury/proposals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer: signerAddress }),
      });
      loadProposals();
    } catch {
      console.error('Failed to approve');
    }
  };

  const handleReject = async (id: string) => {
    if (!signerAddress) return;
    try {
      await fetch(`/api/v1/treasury/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer: signerAddress }),
      });
      loadProposals();
    } catch {
      console.error('Failed to reject');
    }
  };

  const handleExecute = async (id: string) => {
    try {
      await fetch(`/api/v1/treasury/proposals/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executedBy: signerAddress || 'system' }),
      });
      loadProposals();
    } catch {
      console.error('Failed to execute');
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-700',
      approved: 'bg-green-100 text-green-700',
      executed: 'bg-blue-100 text-blue-700',
      rejected: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return <Badge className={colors[status] ?? 'bg-gray-100'}>{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 text-gray-900">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Treasury Management</h1>
            <p className="text-gray-500 mt-1">Multi-signature timelock treasury proposals</p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              placeholder="Your signer address"
              value={signerAddress}
              onChange={(e) => setSignerAddress(e.target.value)}
              className="w-64"
            />
            <Dialog open={showPropose} onOpenChange={setShowPropose}>
              <DialogTrigger asChild>
                <Button>New Proposal</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Proposal</DialogTitle>
                  <DialogDescription>Submit a new treasury transaction for signer approval</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Proposer Address</Label>
                    <Input value={form.proposer} onChange={(e) => setForm({ ...form, proposer: e.target.value })} placeholder="G..." />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this transaction does" />
                  </div>
                  <div>
                    <Label>Target Address</Label>
                    <Input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="Recipient or contract address" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Amount</Label>
                      <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="1000" />
                    </div>
                    <div>
                      <Label>Threshold</Label>
                      <Input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: parseInt(e.target.value) || 1 })} />
                    </div>
                  </div>
                  <div>
                    <Label>Timelock (seconds)</Label>
                    <Input type="number" value={form.timelockDelay} onChange={(e) => setForm({ ...form, timelockDelay: parseInt(e.target.value) || 3600 })} />
                  </div>
                  <Button onClick={handlePropose} className="w-full">Submit Proposal</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {isLoading ? (
          <p className="text-center py-12 text-gray-500">Loading proposals...</p>
        ) : proposals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">No treasury proposals yet</p>
              <Button variant="outline" className="mt-4" onClick={() => setShowPropose(true)}>Create First Proposal</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal) => (
              <Card key={proposal.id}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{proposal.description}</CardTitle>
                      <CardDescription>Proposed by {proposal.proposer.slice(0, 8)}...{proposal.proposer.slice(-6)}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(proposal.status)}
                      <span className="text-sm text-gray-500">
                        {proposal.approvalCount}/{proposal.threshold} approvals
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                    <div>
                      <span className="text-gray-500">Target:</span>{' '}
                      <span className="font-mono">{proposal.target.slice(0, 8)}...{proposal.target.slice(-6)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Amount:</span>{' '}
                      <span className="font-medium">{proposal.amount}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Timelock:</span>{' '}
                      <span className="font-mono">{new Date(proposal.executeAfter).toLocaleString()}</span>
                    </div>
                  </div>

                  {proposal.approvals.length > 0 && (
                    <div className="mb-4">
                      <Label className="text-xs text-gray-500">Signer Activity</Label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {proposal.approvals.map((a) => (
                          <Badge key={a.id} variant={a.approved ? 'default' : 'destructive'}>
                            {a.signer.slice(0, 6)}...{a.approved ? '✓' : '✗'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {proposal.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleApprove(proposal.id)} disabled={!signerAddress}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => handleReject(proposal.id)} disabled={!signerAddress}>Reject</Button>
                    </div>
                  )}
                  {proposal.status === 'approved' && new Date(proposal.executeAfter) <= new Date() && (
                    <Button size="sm" onClick={() => handleExecute(proposal.id)}>Execute</Button>
                  )}
                  {proposal.status === 'approved' && new Date(proposal.executeAfter) > new Date() && (
                    <p className="text-sm text-amber-600">Timelock active — executable after {new Date(proposal.executeAfter).toLocaleString()}</p>
                  )}
                  {proposal.status === 'executed' && proposal.execution && (
                    <div className="text-sm text-gray-500">
                      Executed by {proposal.execution.executedBy} at {new Date(proposal.execution.executedAt).toLocaleString()}
                      {proposal.execution.txHash && <span className="ml-2 font-mono">Tx: {proposal.execution.txHash.slice(0, 16)}...</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
