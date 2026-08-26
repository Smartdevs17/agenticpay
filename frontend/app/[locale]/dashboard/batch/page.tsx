'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Upload, FileText, AlertTriangle, CheckCircle, Clock, Send, Calendar } from 'lucide-react';

interface ParsedRow {
  recipient: string;
  amount: string;
  asset: string;
  memo?: string;
}

interface ParseResult {
  total: number;
  valid: number;
  parseErrors: Array<{ line: number; error: string }>;
  duplicates: number[];
  preview: ParsedRow[];
}

interface EstimateResult {
  totalPayments: number;
  totalAmount: string;
  byAsset: Record<string, string>;
  estimatedGasUnits: number;
  duplicateCount: number;
  invalidAddressCount: number;
  estimatedDurationMs: number;
}

export default function DashboardBatchPage() {
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      let result: ParseResult;

      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const json = JSON.parse(text);
        const payments = Array.isArray(json) ? json : json.payments;
        const response = await api.batch.parse({ payments });
        result = response as unknown as ParseResult;
      } else {
        const text = await file.text();
        const response = await api.batch.parseCSV(text);
        result = response as unknown as ParseResult;
      }

      setParseResult(result);

      if (result.preview.length > 0) {
        const estimateResponse = await api.batch.estimate({ payments: result.preview });
        setEstimate(estimateResponse as unknown as EstimateResult);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to parse file. Please check the format.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = async () => {
    if (!parseResult || parseResult.preview.length === 0) {
      toast.error('No payments to submit');
      return;
    }

    setSubmitting(true);
    try {
      if (scheduleTime) {
        const scheduled = await api.batch.schedule({
          payments: parseResult.preview,
          executeAt: scheduleTime,
        });
        toast.success(`Batch scheduled for ${new Date(scheduleTime).toLocaleString()}`);
        console.log('Scheduled batch:', scheduled);
      } else {
        const result = await api.batch.submit({ payments: parseResult.preview });
        toast.success(`Batch submitted: ${result.succeeded}/${result.total} succeeded`);
        console.log('Batch result:', result);
      }
      setParseResult(null);
      setEstimate(null);
      setScheduleTime('');
    } catch (error) {
      console.error(error);
      toast.error('Failed to submit batch');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 pb-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Batch Payments</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Upload CSV or JSON files to process bulk payments in a single transaction.
        </p>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Payment File
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p className="mb-2 text-gray-600 dark:text-gray-400">
                Drop your CSV or JSON file here, or click to browse
              </p>
              <p className="text-sm text-gray-500 mb-4">
                CSV format: recipient, amount, asset, memo
              </p>
              <Input
                type="file"
                accept=".csv,.json,.txt"
                onChange={handleFileUpload}
                className="max-w-xs mx-auto"
                disabled={loading}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const blob = await fetch('/api/batch/template').then((r) => r.blob());
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'batch_template.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {
                    toast.error('Failed to download template');
                  }
                }}
              >
                Download CSV Template
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Parse Results */}
      {parseResult && (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{parseResult.total}</div>
                <div className="text-sm text-blue-600 dark:text-blue-400">Total Rows</div>
              </div>
              <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                <div className="text-xl font-bold text-green-700 dark:text-green-300">{parseResult.valid}</div>
                <div className="text-sm text-green-600 dark:text-green-400">Valid</div>
              </div>
              <div className="text-center p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                <div className="text-xl font-bold text-red-700 dark:text-red-300">{parseResult.parseErrors.length}</div>
                <div className="text-sm text-red-600 dark:text-red-400">Parse Errors</div>
              </div>
              <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                <div className="text-xl font-bold text-yellow-700 dark:text-yellow-300">{parseResult.duplicates.length}</div>
                <div className="text-sm text-yellow-600 dark:text-yellow-400">Duplicates</div>
              </div>
            </div>

            {parseResult.parseErrors.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-2">Parse Errors:</p>
                {parseResult.parseErrors.slice(0, 5).map((err, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">
                    Line {err.line}: {err.error}
                  </p>
                ))}
              </div>
            )}

            {parseResult.preview.length > 0 && (
              <div className="max-h-64 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Memo</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseResult.preview.slice(0, 20).map((row, i) => (
                      <TableRow key={i} className={parseResult.duplicates.includes(i) ? 'bg-yellow-50 dark:bg-yellow-950' : ''}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{row.recipient.slice(0, 12)}...</TableCell>
                        <TableCell>{row.amount}</TableCell>
                        <TableCell>{row.asset}</TableCell>
                        <TableCell>{row.memo || '-'}</TableCell>
                        <TableCell>
                          {parseResult.duplicates.includes(i) ? (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                              <AlertTriangle className="h-3 w-3 mr-1" />Duplicate
                            </Badge>
                          ) : (
                            <Badge variant="default" className="bg-green-100 text-green-800">
                              <CheckCircle className="h-3 w-3 mr-1" />Valid
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parseResult.preview.length > 20 && (
                  <p className="text-center text-sm text-gray-500 mt-2">
                    Showing 20 of {parseResult.preview.length} rows
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Estimate Results */}
      {estimate && (
        <Card>
          <CardHeader>
            <CardTitle>Dry-Run Estimate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                <div className="text-xl font-bold text-purple-700 dark:text-purple-300">{estimate.totalAmount}</div>
                <div className="text-sm text-purple-600 dark:text-purple-400">Total Amount</div>
              </div>
              <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{estimate.estimatedGasUnits}</div>
                <div className="text-sm text-blue-600 dark:text-blue-400">Est. Gas Units</div>
              </div>
              <div className="text-center p-3 bg-orange-50 dark:bg-orange-950 rounded-lg">
                <div className="text-xl font-bold text-orange-700 dark:text-orange-300">{estimate.invalidAddressCount}</div>
                <div className="text-sm text-orange-600 dark:text-orange-400">Invalid Addresses</div>
              </div>
              <div className="text-center p-3 bg-teal-50 dark:bg-teal-950 rounded-lg">
                <div className="text-xl font-bold text-teal-700 dark:text-teal-300">{estimate.estimatedDurationMs}ms</div>
                <div className="text-sm text-teal-600 dark:text-teal-400">Est. Duration</div>
              </div>
            </div>
            {Object.keys(estimate.byAsset).length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Breakdown by Asset:</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(estimate.byAsset).map(([asset, amount]) => (
                    <Badge key={asset} variant="outline">{asset}: {amount}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submit / Schedule Section */}
      {parseResult && parseResult.preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Execute Batch</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <Label htmlFor="scheduleTime">Schedule for later (optional)</Label>
                <Input
                  id="scheduleTime"
                  type="datetime-local"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="min-w-32"
              >
                {submitting ? (
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                ) : scheduleTime ? (
                  <Calendar className="h-4 w-4 mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {scheduleTime ? 'Schedule' : 'Submit Now'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
