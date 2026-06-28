'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, Link2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, AuditLogEntry } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [valid, setValid] = useState<boolean | undefined>();
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [entryResponse, verifyResponse] = await Promise.all([
        api.audit.listEntries({ userId: actor || undefined, action: action || undefined, resource: resource || undefined, limit: 100 }),
        api.audit.verify(),
      ]);
      setEntries(entryResponse.entries);
      setTotal(entryResponse.total);
      setValid(verifyResponse.valid);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const anchor = async () => {
    try {
      await api.audit.anchor();
      toast.success('Audit hash anchor recorded');
    } catch (error) {
      console.error(error);
      toast.error('Failed to anchor audit hash');
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950 dark:text-white">Audit Log</h1>
          <div className="mt-2 flex items-center gap-2">
            {valid ? (
              <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle className="mr-1 h-3 w-3" />Verified</Badge>
            ) : (
              <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Tamper check failed</Badge>
            )}
            <span className="text-sm text-muted-foreground">{total} entries</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={anchor}>
            <Link2 className="mr-2 h-4 w-4" />
            Anchor
          </Button>
          <Button variant="outline" asChild>
            <a href={api.audit.exportCsvUrl}><Download className="mr-2 h-4 w-4" />CSV</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={api.audit.exportJsonUrl}><Download className="mr-2 h-4 w-4" />JSON</a>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
        <div className="space-y-2">
          <Label htmlFor="actor">Actor</Label>
          <Input id="actor" value={actor} onChange={(event) => setActor(event.target.value)} placeholder="user id" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="action">Action</Label>
          <Input id="action" value={action} onChange={(event) => setAction(event.target.value)} placeholder="auth.login.success" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="resource">Resource</Label>
          <Input id="resource" value={resource} onChange={(event) => setResource(event.target.value)} placeholder="payment" />
        </div>
        <Button onClick={load}>
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Resource</th>
              <th className="px-4 py-3 font-medium">Hash</th>
              <th className="px-4 py-3 font-medium">Previous Hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-gray-200 dark:border-gray-800">
                <td className="px-4 py-3">{new Date(entry.timestamp).toLocaleString()}</td>
                <td className="px-4 py-3">{entry.userId ?? 'system'}</td>
                <td className="px-4 py-3"><Badge variant="outline">{entry.action}</Badge></td>
                <td className="px-4 py-3">{entry.resource}</td>
                <td className="px-4 py-3 font-mono text-xs">{entry.hash.slice(0, 16)}...</td>
                <td className="px-4 py-3 font-mono text-xs">{entry.previousHash.slice(0, 16)}...</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && entries.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">No audit entries found</div>
        )}
      </div>
    </div>
  );
}
