'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Clock, FileText, MessageSquare, Scale, Upload } from 'lucide-react';

interface Dispute {
  id: string;
  projectId: string;
  raisedBy: string;
  raisedAgainst: string;
  reason: string;
  status: string;
  evidence: Array<{ id: string; type: string; title: string; uploadedBy: string; uploadedAt: number }>;
  arbitratorId?: string;
  resolution?: { type: string; description: string; approvedBy: string };
  createdAt: number;
  updatedAt: number;
}

interface Arbitrator {
  id: string;
  name: string;
  address: string;
  specializations: string[];
  activeDisputes: number;
  totalResolved: number;
  rating: number;
}

const statusColors: Record<string, string> = {
  opened: 'bg-yellow-100 text-yellow-800',
  evidence_gathering: 'bg-blue-100 text-blue-800',
  under_review: 'bg-purple-100 text-purple-800',
  resolved: 'bg-green-100 text-green-800',
  appealed: 'bg-orange-100 text-orange-800',
  closed: 'bg-gray-100 text-gray-800',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={statusColors[status] || 'bg-gray-100'}>
      {status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
    </Badge>
  );
}

function EvidenceUpload({ disputeId, onUploaded }: { disputeId: string; onUploaded: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'document' | 'image' | 'message'>('document');
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async () => {
    if (!title || !url) return;
    setUploading(true);
    try {
      await fetch(`/api/v1/disputes/${disputeId}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, description, url, uploadedBy: 'current_user' }),
      });
      setTitle('');
      setDescription('');
      setUrl('');
      onUploaded();
    } catch (err) {
      console.error('Failed to upload evidence:', err);
    } finally {
      setUploading(false);
    }
  }, [disputeId, title, description, type, url, onUploaded]);

  return (
    <div className="space-y-3 p-4 border rounded-lg">
      <h4 className="font-medium flex items-center gap-2"><Upload className="w-4 h-4" /> Upload Evidence</h4>
      <Select value={type} onValueChange={(v: string) => setType(v as any)}>
        <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="document">Document</SelectItem>
          <SelectItem value="image">Image</SelectItem>
          <SelectItem value="message">Message</SelectItem>
        </SelectContent>
      </Select>
      <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <Textarea placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
      <Input placeholder="URL to evidence" value={url} onChange={e => setUrl(e.target.value)} />
      <Button onClick={handleUpload} disabled={uploading || !title || !url}>
        {uploading ? 'Uploading...' : 'Upload'}
      </Button>
    </div>
  );
}

function DisputeDetail({ dispute, onClose }: { dispute: Dispute; onClose: () => void }) {
  const [localDispute, setLocalDispute] = useState(dispute);
  const [refreshing, setRefreshing] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/disputes/${dispute.id}`);
      const data = await res.json();
      setLocalDispute(data.dispute);
    } catch { /* ignore */ }
  }, [dispute.id]);

  useEffect(() => { refresh(); }, [refreshing, refresh]);

  const handleResolve = async (type: string) => {
    try {
      await fetch(`/api/v1/disputes/${dispute.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, description: `Resolved via ${type}`, approvedBy: 'arbitrator' }),
      });
      setRefreshing(v => v + 1);
    } catch (err) {
      console.error('Failed to resolve dispute:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Dispute #{localDispute.id.slice(0, 8)}</h3>
          <p className="text-sm text-muted-foreground">Project: {localDispute.projectId}</p>
        </div>
        <StatusBadge status={localDispute.status} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Reason</CardTitle></CardHeader>
        <CardContent><p className="text-sm">{localDispute.reason}</p></CardContent>
      </Card>

      <div>
        <h4 className="font-medium mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Evidence ({localDispute.evidence.length})</h4>
        {localDispute.evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evidence uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {localDispute.evidence.map(e => (
              <div key={e.id} className="flex items-center justify-between p-2 border rounded text-sm">
                <span>{e.title}</span>
                <span className="text-xs text-muted-foreground">{e.type} by {e.uploadedBy}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {localDispute.status !== 'closed' && localDispute.status !== 'resolved' && (
        <EvidenceUpload disputeId={dispute.id} onUploaded={() => setRefreshing(v => v + 1)} />
      )}

      {localDispute.arbitratorId && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Arbitrator</CardTitle></CardHeader>
          <CardContent><p className="text-sm">ID: {localDispute.arbitratorId}</p></CardContent>
        </Card>
      )}

      {localDispute.resolution && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /> Resolution</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">Type: {localDispute.resolution.type}</p>
            <p className="text-sm">{localDispute.resolution.description}</p>
          </CardContent>
        </Card>
      )}

      {localDispute.status === 'under_review' && (
        <div className="flex gap-2">
          <Button onClick={() => handleResolve('release')} className="bg-green-600">Release to Freelancer</Button>
          <Button onClick={() => handleResolve('refund')} variant="destructive">Refund to Client</Button>
          <Button onClick={() => handleResolve('split')} variant="outline">Split</Button>
        </div>
      )}
    </div>
  );
}

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [arbitrators, setArbitrators] = useState<Arbitrator[]>([]);
  const [workload, setWorkload] = useState<{ total: number; available: number; avgActiveDisputes: number } | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('disputes');

  const fetchData = useCallback(async () => {
    try {
      const [dRes, aRes] = await Promise.all([
        fetch('/api/v1/disputes'),
        fetch('/api/v1/disputes/arbitrators'),
      ]);
      const dData = await dRes.json();
      const aData = await aRes.json();
      setDisputes(dData.disputes || []);
      setArbitrators(aData.arbitrators || []);
      setWorkload(aData.workload || null);
    } catch (err) {
      console.error('Failed to fetch dispute data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openDisputes = disputes.filter(d => d.status !== 'closed' && d.status !== 'resolved');
  const closedDisputes = disputes.filter(d => d.status === 'closed' || d.status === 'resolved');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dispute Resolution</h1>
          <p className="text-sm text-muted-foreground">
            {openDisputes.length} open · {closedDisputes.length} resolved
          </p>
        </div>
      </div>

      {workload && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Arbitrators</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{workload.total}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Available</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-green-600">{workload.available}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Avg Active Disputes</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{workload.avgActiveDisputes.toFixed(1)}</p></CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="disputes" className="flex items-center gap-2">
            <Scale className="w-4 h-4" /> Disputes
          </TabsTrigger>
          <TabsTrigger value="arbitrators" className="flex items-center gap-2">
            <Scale className="w-4 h-4" /> Arbitrators
          </TabsTrigger>
        </TabsList>

        <TabsContent value="disputes" className="space-y-4 mt-4">
          {selectedDispute ? (
            <div>
              <Button variant="ghost" onClick={() => setSelectedDispute(null)} className="mb-4">← Back to list</Button>
              <DisputeDetail dispute={selectedDispute} onClose={() => setSelectedDispute(null)} />
            </div>
          ) : (
            <>
              {disputes.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Scale className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No disputes yet. Disputes will appear here when raised.</p>
                  </CardContent>
                </Card>
              ) : (
                disputes.map(dispute => (
                  <Card key={dispute.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedDispute(dispute)}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Project: {dispute.projectId}</p>
                          <p className="text-sm text-muted-foreground mt-1">{dispute.reason.slice(0, 100)}...</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            {dispute.evidence.length} evidence
                          </span>
                          <StatusBadge status={dispute.status} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="arbitrators" className="space-y-4 mt-4">
          {arbitrators.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p>No arbitrators registered.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {arbitrators.map(arb => (
                <Card key={arb.id}>
                  <CardHeader>
                    <CardTitle className="text-base">{arb.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Rating:</span>
                      <span className="font-medium">{arb.rating}/5.0</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Active:</span>
                      <span className="font-medium">{arb.activeDisputes}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Resolved:</span>
                      <span className="font-medium">{arb.totalResolved}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {arb.specializations.map(s => (
                        <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                      ))}
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
