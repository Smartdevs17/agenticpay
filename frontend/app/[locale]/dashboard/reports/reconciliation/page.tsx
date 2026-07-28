'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Download,
  FileText,
  Eye,
  Calendar,
  Loader2,
} from 'lucide-react';

interface ReportPreview {
  rows: any[];
  totalRows: number;
  dailySummaries: { date: string; chain: string; txCount: number; totalAmount: string; totalFee: string; totalNet: string }[];
  weeklySummaries: { week: string; chain: string; txCount: number; totalAmount: string; totalFee: string; totalNet: string }[];
  monthlySummaries: { month: string; chain: string; txCount: number; totalAmount: string; totalFee: string; totalNet: string }[];
  generatedAt: string;
}

export default function ReconciliationReportPage() {
  const t = useTranslations('dashboard');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [chain, setChain] = useState('');
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePreview = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      setError('Start and end dates are required');
      return;
    }

    setLoading(true);
    setError(null);
    const tenantId = 'default';

    try {
      const res = await fetch('/api/v1/reconciliation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ dateFrom, dateTo, chain: chain || undefined, status: status || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Preview failed');
      setPreview(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, chain, status]);

  const handleDownload = useCallback(async () => {
    if (!dateFrom || !dateTo) return;

    setLoading(true);
    setError(null);
    const tenantId = 'default';

    try {
      const res = await fetch('/api/v1/reconciliation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ dateFrom, dateTo, chain: chain || undefined, status: status || undefined, format }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Generation failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-${dateFrom}-${dateTo}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, chain, status, format]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Payment Reconciliation Report</h1>
        <p className="text-muted-foreground text-sm">
          Generate reconciliation reports matching on-chain settlements against internal records
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" /> Report Parameters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label>Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Chain (optional)</Label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger><SelectValue placeholder="All chains" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All chains</SelectItem>
                  <SelectItem value="stellar">Stellar</SelectItem>
                  <SelectItem value="ethereum">Ethereum</SelectItem>
                  <SelectItem value="polygon">Polygon</SelectItem>
                  <SelectItem value="arbitrum">Arbitrum</SelectItem>
                  <SelectItem value="base">Base</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status (optional)</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as 'csv' | 'pdf')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex items-end gap-2">
              <Button onClick={handlePreview} disabled={loading || !dateFrom || !dateTo}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                <span className="ml-2 hidden md:inline">Preview</span>
              </Button>
              <Button onClick={handleDownload} disabled={loading || !dateFrom || !dateTo} variant="outline">
                <Download className="h-4 w-4" />
                <span className="ml-2 hidden md:inline">Download</span>
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-4 text-sm text-red-500">{error}</div>
          )}
        </CardContent>
      </Card>

      {preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Total Transactions</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{preview.totalRows}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Date Range</CardTitle></CardHeader>
              <CardContent><div className="text-sm">{preview.dateFrom} to {preview.dateTo}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Summaries</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{preview.dailySummaries.length}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Generated</CardTitle></CardHeader>
              <CardContent><div className="text-sm">{new Date(preview.generatedAt).toLocaleString()}</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Report Data
              </CardTitle>
              <CardDescription>
                Showing {Math.min(preview.rows.length, 100)} of {preview.totalRows} rows
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="transactions">
                <TabsList>
                  <TabsTrigger value="transactions">Transactions</TabsTrigger>
                  <TabsTrigger value="daily">Daily Summary</TabsTrigger>
                  <TabsTrigger value="weekly">Weekly Summary</TabsTrigger>
                  <TabsTrigger value="monthly">Monthly Summary</TabsTrigger>
                </TabsList>

                <TabsContent value="transactions" className="mt-4">
                  <div className="max-h-96 overflow-y-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>TX ID</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Chain</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Fee</TableHead>
                          <TableHead>Net</TableHead>
                          <TableHead>Sender</TableHead>
                          <TableHead>Receiver</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rows.map((row: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{row.txId.slice(0, 12)}...</TableCell>
                            <TableCell>{row.date}</TableCell>
                            <TableCell><Badge variant="outline">{row.chain}</Badge></TableCell>
                            <TableCell>{row.amount}</TableCell>
                            <TableCell>{row.fee}</TableCell>
                            <TableCell>{row.net}</TableCell>
                            <TableCell className="max-w-[100px] truncate">{row.sender}</TableCell>
                            <TableCell className="max-w-[100px] truncate">{row.receiver}</TableCell>
                            <TableCell><Badge variant={row.status === 'completed' ? 'default' : 'secondary'}>{row.status}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="daily" className="mt-4">
                  <div className="max-h-96 overflow-y-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Chain</TableHead>
                          <TableHead>Transactions</TableHead>
                          <TableHead>Total Amount</TableHead>
                          <TableHead>Total Fee</TableHead>
                          <TableHead>Total Net</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.dailySummaries.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell>{s.date}</TableCell>
                            <TableCell><Badge variant="outline">{s.chain}</Badge></TableCell>
                            <TableCell>{s.txCount}</TableCell>
                            <TableCell>{s.totalAmount}</TableCell>
                            <TableCell>{s.totalFee}</TableCell>
                            <TableCell>{s.totalNet}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="weekly" className="mt-4">
                  <div className="max-h-96 overflow-y-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Week Starting</TableHead>
                          <TableHead>Chain</TableHead>
                          <TableHead>Transactions</TableHead>
                          <TableHead>Total Amount</TableHead>
                          <TableHead>Total Fee</TableHead>
                          <TableHead>Total Net</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.weeklySummaries.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell>{s.week}</TableCell>
                            <TableCell><Badge variant="outline">{s.chain}</Badge></TableCell>
                            <TableCell>{s.txCount}</TableCell>
                            <TableCell>{s.totalAmount}</TableCell>
                            <TableCell>{s.totalFee}</TableCell>
                            <TableCell>{s.totalNet}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="monthly" className="mt-4">
                  <div className="max-h-96 overflow-y-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Month</TableHead>
                          <TableHead>Chain</TableHead>
                          <TableHead>Transactions</TableHead>
                          <TableHead>Total Amount</TableHead>
                          <TableHead>Total Fee</TableHead>
                          <TableHead>Total Net</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.monthlySummaries.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell>{s.month}</TableCell>
                            <TableCell><Badge variant="outline">{s.chain}</Badge></TableCell>
                            <TableCell>{s.txCount}</TableCell>
                            <TableCell>{s.totalAmount}</TableCell>
                            <TableCell>{s.totalFee}</TableCell>
                            <TableCell>{s.totalNet}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
