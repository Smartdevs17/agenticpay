'use client';

import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Plus,
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  FileText,
  Wallet,
  ShieldCheck,
  Bell,
  Trash2,
  UserPlus,
  UserMinus,
  CheckCheck,
  X as XIcon,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { EmptyState } from '@/components/empty/EmptyState';
import { formatDateInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MultisigMode = 'onchain' | 'offchain';
type GroupStatus = 'active' | 'inactive';
type ProposalStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'cancelled' | 'expired';
type ApprovalAction = 'approved' | 'rejected';

type Approval = {
  id: string;
  proposalId: string;
  signer: string;
  signature: string;
  action: ApprovalAction;
  reason?: string;
  timestamp: string;
};

type MultisigGroup = {
  id: string;
  name: string;
  walletAddresses: string[];
  threshold: number;
  mode: MultisigMode;
  status: GroupStatus;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
};

type Proposal = {
  id: string;
  groupId: string;
  amount: number;
  currency: string;
  description?: string;
  recipient?: string;
  status: ProposalStatus;
  approvals: Approval[];
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  expiresAt: string | null;
  metadata: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const SEED_GROUPS: MultisigGroup[] = [
  {
    id: 'grp-001',
    name: 'Engineering Treasury',
    walletAddresses: [
      '0x742d35cc6634c0532925a3b844bc9e7595f42bed',
      '0x8ba1f109551bd432803012645ac136ddd64dba72',
      '0x1234567890123456789012345678901234567890',
    ],
    threshold: 2,
    mode: 'offchain',
    status: 'active',
    timeoutSeconds: 86400,
    createdAt: '2026-05-01T08:00:00Z',
    updatedAt: '2026-05-01T08:00:00Z',
  },
  {
    id: 'grp-002',
    name: 'Marketing Budget',
    walletAddresses: [
      '0x742d35cc6634c0532925a3b844bc9e7595f42bed',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ],
    threshold: 2,
    mode: 'offchain',
    status: 'active',
    timeoutSeconds: 172800,
    createdAt: '2026-05-10T10:00:00Z',
    updatedAt: '2026-05-10T10:00:00Z',
  },
];

const SEED_PROPOSALS: Proposal[] = [
  {
    id: 'prop-001',
    groupId: 'grp-001',
    amount: 2000,
    currency: 'USD',
    description: 'Website Redesign — Phase 1 milestone payment',
    recipient: '0x742d35cc6634c0532925a3b844bc9e7595f42bed',
    status: 'pending',
    approvals: [
      { id: 'appr-1', proposalId: 'prop-001', signer: '0x8ba1f109551bd432803012645ac136ddd64dba72', signature: '0xsig1', action: 'approved', timestamp: '2026-05-27T10:00:00Z' },
    ],
    createdAt: '2026-05-27T08:00:00Z',
    updatedAt: '2026-05-27T10:30:00Z',
    executedAt: null,
    expiresAt: '2026-06-02T08:00:00Z',
    metadata: {},
  },
  {
    id: 'prop-002',
    groupId: 'grp-001',
    amount: 4000,
    currency: 'USD',
    description: 'Mobile App MVP — Phase 2 core features implementation',
    recipient: '0x8ba1f109551bd432803012645ac136ddd64dba72',
    status: 'executed',
    approvals: [
      { id: 'appr-2', proposalId: 'prop-002', signer: '0x742d35cc6634c0532925a3b844bc9e7595f42bed', signature: '0xsig2', action: 'approved', timestamp: '2026-05-26T14:00:00Z' },
      { id: 'appr-3', proposalId: 'prop-002', signer: '0x8ba1f109551bd432803012645ac136ddd64dba72', signature: '0xsig3', action: 'approved', timestamp: '2026-05-26T15:30:00Z' },
    ],
    createdAt: '2026-05-26T12:00:00Z',
    updatedAt: '2026-05-26T15:30:00Z',
    executedAt: '2026-05-26T15:30:00Z',
    expiresAt: null,
    metadata: {},
  },
  {
    id: 'prop-003',
    groupId: 'grp-002',
    amount: 800,
    currency: 'USD',
    description: 'Q2 campaign ad spend',
    recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    status: 'pending',
    approvals: [],
    createdAt: '2026-05-30T09:00:00Z',
    updatedAt: '2026-05-30T09:00:00Z',
    executedAt: null,
    expiresAt: '2026-06-01T09:00:00Z',
    metadata: {},
  },
];

const CURRENT_USER = '0x742d35cc6634c0532925a3b844bc9e7595f42bed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function statusColors(status: ProposalStatus | GroupStatus) {
  switch (status) {
    case 'executed':
    case 'approved':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'pending':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'rejected':
    case 'cancelled':
    case 'expired':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

function StatusIcon({ status }: { status: ProposalStatus }) {
  if (status === 'executed' || status === 'approved') return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  if (status === 'pending') return <Clock className="h-5 w-5 text-yellow-600" />;
  return <AlertCircle className="h-5 w-5 text-red-600" />;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CreateWalletDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (group: MultisigGroup) => void;
}) {
  const [name, setName] = useState('');
  const [signersRaw, setSignersRaw] = useState('');
  const [threshold, setThreshold] = useState(2);
  const [timeoutHours, setTimeoutHours] = useState(24);
  const [mode, setMode] = useState<MultisigMode>('offchain');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const signers = useMemo(
    () =>
      signersRaw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    [signersRaw]
  );

  const handleSubmit = useCallback(async () => {
    setError('');
    if (!name.trim()) { setError('Wallet name is required'); return; }
    if (signers.length < 2) { setError('At least 2 signers are required'); return; }
    if (threshold < 1 || threshold > signers.length) {
      setError(`Threshold must be between 1 and ${signers.length}`);
      return;
    }

    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 500)); // simulate API

    const group: MultisigGroup = {
      id: `grp-${Date.now()}`,
      name: name.trim(),
      walletAddresses: signers.map((s) => s.toLowerCase()),
      threshold,
      mode,
      status: 'active',
      timeoutSeconds: timeoutHours * 3600,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setSubmitting(false);
    onCreated(group);
    setName(''); setSignersRaw(''); setThreshold(2); setTimeoutHours(24);
  }, [name, signers, threshold, mode, timeoutHours, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            Create Multi-Sig Wallet
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          <div className="space-y-1">
            <Label>Wallet Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering Treasury" />
          </div>
          <div className="space-y-1">
            <Label>Signer Addresses <span className="text-gray-400 text-xs">(one per line, min 2)</span></Label>
            <textarea
              className="w-full min-h-[120px] rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={signersRaw}
              onChange={(e) => setSignersRaw(e.target.value)}
              placeholder={"0xAddress1\n0xAddress2\n0xAddress3"}
            />
            <p className="text-xs text-gray-500">{signers.length} address{signers.length !== 1 ? 'es' : ''} entered</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Approval Threshold</Label>
              <Input
                type="number"
                min={1}
                max={signers.length || 1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <p className="text-xs text-gray-500">
                {signers.length > 0 ? `${threshold} of ${signers.length}` : '—'}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Proposal Timeout (hours)</Label>
              <Input
                type="number"
                min={1}
                value={timeoutHours}
                onChange={(e) => setTimeoutHours(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Mode</Label>
            <div className="flex gap-2">
              {(['offchain', 'onchain'] as MultisigMode[]).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? 'default' : 'outline'}
                  onClick={() => setMode(m)}
                  className="capitalize"
                >
                  {m}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Create Wallet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateProposalDialog({
  open,
  groups,
  onClose,
  onCreated,
}: {
  open: boolean;
  groups: MultisigGroup[];
  onClose: () => void;
  onCreated: (proposal: Proposal) => void;
}) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [recipient, setRecipient] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async () => {
    setError('');
    if (!groupId) { setError('Select a wallet'); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setError('Valid amount required'); return; }

    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 500));

    const group = groups.find((g) => g.id === groupId)!;
    const proposal: Proposal = {
      id: `prop-${Date.now()}`,
      groupId,
      amount: Number(Number(amount).toFixed(2)),
      currency: currency.toUpperCase(),
      description: description.trim() || undefined,
      recipient: recipient.trim().toLowerCase() || undefined,
      status: 'pending',
      approvals: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executedAt: null,
      expiresAt: group.timeoutSeconds
        ? new Date(Date.now() + group.timeoutSeconds * 1000).toISOString()
        : null,
      metadata: {},
    };

    setSubmitting(false);
    onCreated(proposal);
    setAmount(''); setDescription(''); setRecipient('');
  }, [groupId, amount, currency, description, recipient, groups, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            New Payment Proposal
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          <div className="space-y-1">
            <Label>Wallet</Label>
            <select
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {groups.filter((g) => g.status === 'active').map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({g.threshold}-of-{g.walletAddresses.length})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Recipient Address <span className="text-gray-400 text-xs">(optional)</span></Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" className="font-mono text-sm" />
          </div>
          <div className="space-y-1">
            <Label>Description <span className="text-gray-400 text-xs">(optional)</span></Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Purpose of this payment" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Submit Proposal
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignerManagementDialog({
  open,
  group,
  onClose,
  onUpdated,
}: {
  open: boolean;
  group: MultisigGroup | null;
  onClose: () => void;
  onUpdated: (group: MultisigGroup) => void;
}) {
  const [newSigner, setNewSigner] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!group) return null;

  const handleAdd = async () => {
    setError(''); setSuccess('');
    const normalized = newSigner.trim().toLowerCase();
    if (!normalized) { setError('Enter a signer address'); return; }
    if (group.walletAddresses.includes(normalized)) { setError('Already a signer'); return; }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 400));
    const updated = { ...group, walletAddresses: [...group.walletAddresses, normalized], updatedAt: new Date().toISOString() };
    setSubmitting(false);
    setNewSigner('');
    setSuccess(`Add-signer proposal submitted. Requires ${group.threshold} approvals.`);
    onUpdated(updated);
  };

  const handleRemove = async (addr: string) => {
    setError(''); setSuccess('');
    if (group.walletAddresses.length <= 2) { setError('Cannot remove — minimum 2 signers required'); return; }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 400));
    const updated = {
      ...group,
      walletAddresses: group.walletAddresses.filter((a) => a !== addr),
      threshold: Math.min(group.threshold, group.walletAddresses.length - 1),
      updatedAt: new Date().toISOString(),
    };
    setSubmitting(false);
    setSuccess(`Remove-signer proposal submitted. Requires ${group.threshold} approvals.`);
    onUpdated(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-600" />
            Manage Signers — {group.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          {success && <p className="text-sm text-green-700 bg-green-50 rounded p-2">{success}</p>}
          <p className="text-xs text-gray-500">
            Threshold: {group.threshold} of {group.walletAddresses.length}. Changes require existing signer consensus.
          </p>
          <div className="space-y-2">
            {group.walletAddresses.map((addr) => (
              <div key={addr} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="font-mono text-sm text-gray-800">
                  {shortAddr(addr)}
                  {addr === CURRENT_USER && <span className="ml-2 text-xs text-blue-600">(you)</span>}
                </span>
                {addr !== CURRENT_USER && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => handleRemove(addr)}
                    disabled={submitting}
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label>Add New Signer</Label>
            <div className="flex gap-2">
              <Input
                value={newSigner}
                onChange={(e) => setNewSigner(e.target.value)}
                placeholder="0x…"
                className="font-mono text-sm flex-1"
              />
              <Button onClick={handleAdd} disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <Button variant="outline" onClick={onClose} className="w-full">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProposalCard({
  proposal,
  group,
  timezone,
  onApprove,
  onReject,
  onCancel,
}: {
  proposal: Proposal;
  group: MultisigGroup | undefined;
  timezone: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const approvedCount = proposal.approvals.filter((a) => a.action === 'approved').length;
  const threshold = group?.threshold ?? 1;
  const progress = Math.min(100, Math.round((approvedCount / threshold) * 100));
  const userApproval = proposal.approvals.find((a) => a.signer === CURRENT_USER);
  const isSigner = group?.walletAddresses.includes(CURRENT_USER) ?? false;
  const canAct = isSigner && !userApproval && proposal.status === 'pending';

  return (
    <Card className="border border-gray-200 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <StatusIcon status={proposal.status} />
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-sm truncate">
                {proposal.currency} {proposal.amount.toFixed(2)}
              </p>
              {proposal.description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">{proposal.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors(proposal.status)}`}>
              {proposal.status}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} className="h-7 w-7 p-0">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {proposal.recipient && (
          <p className="text-xs text-gray-600 font-mono">→ {shortAddr(proposal.recipient)}</p>
        )}

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{approvedCount} of {threshold} approvals</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2 overflow-hidden"
            >
              <p className="text-xs font-semibold text-gray-700 pt-1">Signers</p>
              {(group?.walletAddresses ?? []).map((addr) => {
                const approval = proposal.approvals.find((a) => a.signer === addr);
                return (
                  <div key={addr} className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-3 py-1.5 text-xs">
                    <span className="font-mono text-gray-700">
                      {shortAddr(addr)}
                      {addr === CURRENT_USER && <span className="ml-1 text-blue-600">(you)</span>}
                    </span>
                    {approval ? (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${approval.action === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {approval.action}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-600">pending</span>
                    )}
                  </div>
                );
              })}
              {proposal.expiresAt && (
                <p className="text-xs text-gray-400 pt-1">
                  Expires {formatDateInTimeZone(proposal.expiresAt, timezone)}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {canAct && (
          <div className="flex gap-2 pt-1">
            <Button onClick={() => onApprove(proposal.id)} size="sm" className="flex-1 bg-green-600 hover:bg-green-700 h-8">
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" /> Approve
            </Button>
            <Button onClick={() => onReject(proposal.id)} size="sm" variant="destructive" className="flex-1 h-8">
              <XIcon className="h-3.5 w-3.5 mr-1.5" /> Reject
            </Button>
          </div>
        )}
        {proposal.status === 'pending' && isSigner && !canAct && userApproval && (
          <Button onClick={() => onCancel(proposal.id)} size="sm" variant="ghost" className="w-full text-xs text-gray-500 h-8">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Cancel Proposal
          </Button>
        )}
        <p className="text-xs text-gray-400">
          Created {formatDateInTimeZone(proposal.createdAt, timezone)}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function StatsBar({ proposals }: { proposals: Proposal[] }) {
  const pending = proposals.filter((p) => p.status === 'pending').length;
  const executed = proposals.filter((p) => p.status === 'executed').length;
  const needsAction = proposals.filter(
    (p) =>
      p.status === 'pending' &&
      !p.approvals.find((a) => a.signer === CURRENT_USER)
  ).length;

  return (
    <div className="grid grid-cols-3 gap-4">
      {[
        { label: 'Pending', value: pending, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
        { label: 'Need My Vote', value: needsAction, icon: Bell, color: 'text-blue-600 bg-blue-50' },
        { label: 'Executed', value: executed, icon: ShieldCheck, color: 'text-green-600 bg-green-50' },
      ].map(({ label, value, icon: Icon, color }) => (
        <Card key={label} className="border border-gray-200">
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`rounded-lg p-2 ${color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Executed', value: 'executed' },
  { label: 'Rejected', value: 'rejected' },
];

export default function MultisigPage() {
  const timezone = useAuthStore((state) => state.timezone);

  const [groups, setGroups] = useState<MultisigGroup[]>(SEED_GROUPS);
  const [proposals, setProposals] = useState<Proposal[]>(SEED_PROPOSALS);

  const [activeTab, setActiveTab] = useState<'proposals' | 'wallets'>('proposals');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [groupFilter, setGroupFilter] = useState('all');

  const [showCreateWallet, setShowCreateWallet] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [managingGroup, setManagingGroup] = useState<MultisigGroup | null>(null);

  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const filteredProposals = useMemo(() => {
    return proposals
      .filter((p) => statusFilter === 'all' || p.status === statusFilter)
      .filter((p) => groupFilter === 'all' || p.groupId === groupFilter);
  }, [proposals, statusFilter, groupFilter]);

  const handleApprove = useCallback((proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        const group = groupMap.get(p.groupId);
        const threshold = group?.threshold ?? 1;
        const newApprovals = [
          ...p.approvals,
          { id: `appr-${Date.now()}`, proposalId, signer: CURRENT_USER, signature: '0xlocal', action: 'approved' as const, timestamp: new Date().toISOString() },
        ];
        const approvedCount = newApprovals.filter((a) => a.action === 'approved').length;
        const status: ProposalStatus = approvedCount >= threshold ? 'executed' : 'pending';
        return { ...p, approvals: newApprovals, status, executedAt: status === 'executed' ? new Date().toISOString() : null, updatedAt: new Date().toISOString() };
      })
    );
  }, [groupMap]);

  const handleReject = useCallback((proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        const group = groupMap.get(p.groupId);
        const blockingThreshold = (group?.walletAddresses.length ?? 1) - (group?.threshold ?? 1) + 1;
        const newApprovals = [
          ...p.approvals,
          { id: `appr-${Date.now()}`, proposalId, signer: CURRENT_USER, signature: '0xlocal', action: 'rejected' as const, timestamp: new Date().toISOString() },
        ];
        const rejectedCount = newApprovals.filter((a) => a.action === 'rejected').length;
        const status: ProposalStatus = rejectedCount >= blockingThreshold ? 'rejected' : 'pending';
        return { ...p, approvals: newApprovals, status, updatedAt: new Date().toISOString() };
      })
    );
  }, [groupMap]);

  const handleCancel = useCallback((proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => p.id === proposalId ? { ...p, status: 'cancelled', updatedAt: new Date().toISOString() } : p)
    );
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Multi-Sig Wallets</h1>
          <p className="text-gray-500 mt-1 text-sm">Team-controlled wallets with configurable approval thresholds</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCreateWallet(true)}>
            <Wallet className="h-4 w-4 mr-2" />
            New Wallet
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowCreateProposal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Proposal
          </Button>
        </div>
      </div>

      {/* Stats */}
      <StatsBar proposals={proposals} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([['proposals', 'Proposals'], ['wallets', 'Wallets']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Proposals tab */}
      {activeTab === 'proposals' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1">
              {STATUS_FILTERS.map(({ label, value }) => (
                <Button
                  key={value}
                  size="sm"
                  variant={statusFilter === value ? 'default' : 'outline'}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <select
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="all">All Wallets</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {filteredProposals.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={FileText}
                  title="No proposals"
                  description="Payment proposals for multi-sig approval will appear here."
                  action={{ label: 'Create Proposal', onClick: () => setShowCreateProposal(true) }}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProposals.map((proposal, i) => (
                <motion.div
                  key={proposal.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <ProposalCard
                    proposal={proposal}
                    group={groupMap.get(proposal.groupId)}
                    timezone={timezone}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onCancel={handleCancel}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wallets tab */}
      {activeTab === 'wallets' && (
        <div className="space-y-4">
          {groups.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={Wallet}
                  title="No wallets"
                  description="Create a multi-sig wallet to get started."
                  action={{ label: 'Create Wallet', onClick: () => setShowCreateWallet(true) }}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((group, i) => {
                const groupProposals = proposals.filter((p) => p.groupId === group.id);
                const pendingCount = groupProposals.filter((p) => p.status === 'pending').length;
                return (
                  <motion.div key={group.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                    <Card className="border border-gray-200 hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <div className="rounded-lg bg-blue-50 p-2">
                              <Wallet className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                              <CardTitle className="text-base">{group.name}</CardTitle>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {group.threshold}-of-{group.walletAddresses.length} · {group.mode}
                              </p>
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors(group.status as any)}`}>
                            {group.status}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {group.walletAddresses.map((addr) => (
                            <Badge key={addr} variant="outline" className="font-mono text-xs">
                              {shortAddr(addr)}
                              {addr === CURRENT_USER && <span className="ml-1 text-blue-600">·you</span>}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>{pendingCount} pending proposal{pendingCount !== 1 ? 's' : ''}</span>
                          {group.timeoutSeconds > 0 && (
                            <span>Timeout: {group.timeoutSeconds / 3600}h</span>
                          )}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-xs"
                            onClick={() => setManagingGroup(group)}
                          >
                            <Settings className="h-3.5 w-3.5 mr-1.5" />
                            Manage Signers
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 text-xs bg-blue-600 hover:bg-blue-700"
                            onClick={() => { setShowCreateProposal(true); }}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            New Proposal
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <CreateWalletDialog
        open={showCreateWallet}
        onClose={() => setShowCreateWallet(false)}
        onCreated={(g) => { setGroups((prev) => [g, ...prev]); setShowCreateWallet(false); }}
      />
      <CreateProposalDialog
        open={showCreateProposal}
        groups={groups}
        onClose={() => setShowCreateProposal(false)}
        onCreated={(p) => { setProposals((prev) => [p, ...prev]); setShowCreateProposal(false); }}
      />
      <SignerManagementDialog
        open={!!managingGroup}
        group={managingGroup}
        onClose={() => setManagingGroup(null)}
        onUpdated={(updated) => {
          setGroups((prev) => prev.map((g) => g.id === updated.id ? updated : g));
          setManagingGroup(updated);
        }}
      />
    </div>
  );
}
