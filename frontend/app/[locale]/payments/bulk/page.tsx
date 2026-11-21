'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Play,
  FileText,
  AlertCircle,
} from 'lucide-react';

interface ValidationRow {
  rowNumber: number;
  status: 'valid' | 'invalid';
  errors: string[];
  warnings: string[];
  parsed?: {
    amount: number;
    destination: string;
    currency?: string;
    memo?: string;
    chain?: string;
  };
}

interface ColumnMapping {
  amount: string;
  destination: string;
  currency?: string;
  memo?: string;
  chain?: string;
}

export default function BulkPaymentPage() {
  const t = useTranslations('payments');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'map' | 'validate' | 'process' | 'complete'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rawData, setRawData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    amount: '',
    destination: '',
  });
  const [validationResult, setValidationResult] = useState<{
    rows: ValidationRow[];
    validCount: number;
    errorCount: number;
  } | null>(null);
  const [bulkId, setBulkId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [processResult, setProcessResult] = useState<{
    processedCount: number;
    failedCount: number;
    status: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);

    const text = await selectedFile.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      setError('File must have a header row and at least one data row');
      return;
    }

    const parsedHeaders = lines[0].split(',').map(h => h.trim().toLowerCase());
    setHeaders(parsedHeaders);

    const data = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row: any = {};
      parsedHeaders.forEach((h, i) => { row[h] = values[i] || ''; });
      return row;
    });
    setRawData(data);

    const autoMap: ColumnMapping = { amount: '', destination: '' };
    for (const h of parsedHeaders) {
      if (['amount', 'price', 'value', 'sum'].includes(h)) autoMap.amount = h;
      else if (['destination', 'to', 'address', 'recipient', 'wallet'].includes(h)) autoMap.destination = h;
      else if (['currency', 'token', 'asset'].includes(h)) autoMap.currency = h;
      else if (['memo', 'note', 'reference', 'description'].includes(h)) autoMap.memo = h;
      else if (['chain', 'network', 'blockchain'].includes(h)) autoMap.chain = h;
    }
    setColumnMapping(autoMap);
    setStep('map');
  }, []);

  const handleValidate = useCallback(async () => {
    if (!columnMapping.amount || !columnMapping.destination) {
      setError('Amount and Destination column mappings are required');
      return;
    }

    setProcessing(true);
    setError(null);
    const tenantId = 'default';

    try {
      const res = await fetch('/api/v1/payments/bulk/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ rows: rawData, columnMapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Validation failed');

      setValidationResult(data);
      setStep('validate');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }, [columnMapping, rawData]);

  const handleUpload = useCallback(async () => {
    if (!validationResult || validationResult.validCount === 0) return;

    setProcessing(true);
    setError(null);
    const tenantId = 'default';

    try {
      const res = await fetch('/api/v1/payments/bulk/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({
          rows: rawData,
          columnMapping,
          fileName: file?.name || 'upload.csv',
          fileSize: file?.size || 0,
          mimeType: file?.type || 'text/csv',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed');

      setBulkId(data.bulkUploadId);
      setStep('process');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }, [validationResult, columnMapping, rawData, file]);

  const handleProcess = useCallback(async () => {
    if (!bulkId) return;

    setProcessing(true);
    setError(null);
    const tenantId = 'default';

    try {
      const res = await fetch(`/api/v1/payments/bulk/${bulkId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Processing failed');

      setProcessResult(data);
      setProcessProgress(100);
      setStep('complete');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }, [bulkId]);

  const downloadTemplate = useCallback(async () => {
    const res = await fetch('/api/v1/payments/bulk/template');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-payment-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadErrorReport = useCallback(async () => {
    if (!bulkId) return;
    const tenantId = 'default';
    const res = await fetch(`/api/v1/payments/bulk/${bulkId}/error-report`, {
      headers: { 'x-tenant-id': tenantId },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk-errors-${bulkId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [bulkId]);

  const reset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setRawData([]);
    setHeaders([]);
    setColumnMapping({ amount: '', destination: '' });
    setValidationResult(null);
    setBulkId(null);
    setProcessResult(null);
    setProcessProgress(0);
    setError(null);
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('bulkPayments') || 'Bulk Payments'}</h1>
          <p className="text-muted-foreground text-sm">
            Upload CSV files to process multiple payments at once
          </p>
        </div>
        {step !== 'upload' && (
          <Button variant="outline" onClick={reset}>
            <ArrowLeft className="mr-2 h-4 w-4" /> New Upload
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'upload' && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Payment File</CardTitle>
            <CardDescription>Upload a CSV or Excel file with your payment data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-lg font-medium">Click to upload or drag and drop</p>
              <p className="text-sm text-muted-foreground">CSV files recommended</p>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            <div className="flex justify-center">
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="mr-2 h-4 w-4" /> Download Template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'map' && (
        <Card>
          <CardHeader>
            <CardTitle>Map Columns</CardTitle>
            <CardDescription>
              Found {headers.length} columns and {rawData.length} rows. Map your CSV columns to payment fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount column *</Label>
                <Select
                  value={columnMapping.amount}
                  onValueChange={(v) => setColumnMapping(p => ({ ...p, amount: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Destination column *</Label>
                <Select
                  value={columnMapping.destination}
                  onValueChange={(v) => setColumnMapping(p => ({ ...p, destination: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Currency column (optional)</Label>
                <Select
                  value={columnMapping.currency || ''}
                  onValueChange={(v) => setColumnMapping(p => ({ ...p, currency: v || undefined }))}
                >
                  <SelectTrigger><SelectValue placeholder="Auto (XLM)" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Memo column (optional)</Label>
                <Select
                  value={columnMapping.memo || ''}
                  onValueChange={(v) => setColumnMapping(p => ({ ...p, memo: v || undefined }))}
                >
                  <SelectTrigger><SelectValue placeholder="No memo" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Chain column (optional)</Label>
                <Select
                  value={columnMapping.chain || ''}
                  onValueChange={(v) => setColumnMapping(p => ({ ...p, chain: v || undefined }))}
                >
                  <SelectTrigger><SelectValue placeholder="Auto (stellar)" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={handleValidate} disabled={processing}>
                {processing ? 'Validating...' : 'Validate & Continue'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'validate' && validationResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Validation Results
              <Badge variant="default" className="ml-2">
                {validationResult.validCount} valid
              </Badge>
              {validationResult.errorCount > 0 && (
                <Badge variant="destructive">
                  {validationResult.errorCount} errors
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Review and fix any errors before proceeding
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-96 overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Errors / Warnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validationResult.rows.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell>
                        {row.status === 'valid' ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                      </TableCell>
                      <TableCell>{row.parsed?.amount ?? '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={row.parsed?.destination}>
                        {row.parsed?.destination ?? '-'}
                      </TableCell>
                      <TableCell>{row.parsed?.currency ?? '-'}</TableCell>
                      <TableCell>
                        {row.errors.map((e, i) => (
                          <div key={i} className="flex items-center gap-1 text-sm text-red-500">
                            <AlertTriangle className="h-3 w-3" /> {e}
                          </div>
                        ))}
                        {row.warnings.map((w, i) => (
                          <div key={i} className="flex items-center gap-1 text-sm text-yellow-500">
                            <AlertTriangle className="h-3 w-3" /> {w}
                          </div>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setStep('map')}>
                Back to Mapping
              </Button>
              <Button
                onClick={handleUpload}
                disabled={processing || validationResult.validCount === 0}
              >
                {processing ? 'Uploading...' : `Upload ${validationResult.validCount} Valid Rows`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'process' && (
        <Card>
          <CardHeader>
            <CardTitle>Execute Payments</CardTitle>
            <CardDescription>
              Process {validationResult?.validCount || 0} validated payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertTitle>Ready to process</AlertTitle>
              <AlertDescription>
                This will create {validationResult?.validCount || 0} payment transactions.
                Monitor progress below after starting.
              </AlertDescription>
            </Alert>
            {processProgress > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{processProgress}%</span>
                </div>
                <Progress value={processProgress} />
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={handleProcess} disabled={processing}>
                {processing ? (
                  <>Processing...</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" /> Execute Payments</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'complete' && processResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
              Processing Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{processResult.processedCount}</div>
                <div className="text-sm text-muted-foreground">Succeeded</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold text-red-600">{processResult.failedCount}</div>
                <div className="text-sm text-muted-foreground">Failed</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <Badge variant={processResult.status === 'completed' ? 'default' : 'secondary'}>
                  {processResult.status}
                </Badge>
                <div className="text-sm text-muted-foreground mt-1">Status</div>
              </div>
            </div>
            {processResult.failedCount > 0 && (
              <Button variant="outline" onClick={downloadErrorReport}>
                <Download className="mr-2 h-4 w-4" /> Download Error Report
              </Button>
            )}
            <div className="flex justify-end">
              <Button onClick={reset}>Upload Another File</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
