'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { apiCall } from '@/lib/api/client';

interface CodeQualityMetrics {
  linesOfCode: number;
  testCoverage: number;
  cyclomaticComplexity: number;
  documentationCoverage: number;
  duplicateCodeRatio: number;
  maintainabilityIndex: number;
}

interface PlagiarismResult {
  overallSimilarity: number;
  duplicateSegments: Array<{ source: string; similarity: number; lines: string }>;
  externalMatches: Array<{ repository: string; similarity: number; description: string }>;
}

interface VerificationResult {
  id: string;
  projectId: string;
  status: 'passed' | 'failed' | 'pending';
  score: number;
  summary: string;
  details: string[];
  verifiedAt: string;
  codeQuality?: CodeQualityMetrics;
  plagiarism?: PlagiarismResult;
}

const statusColors: Record<string, string> = {
  passed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

export default function VerificationPage() {
  const [step, setStep] = useState<'form' | 'result' | 'history'>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [history, setHistory] = useState<VerificationResult[]>([]);

  const [form, setForm] = useState({
    repositoryUrl: '',
    milestoneDescription: '',
    projectId: '',
  });

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await apiCall<{ data: VerificationResult[] }>('/verification');
        setHistory(res.data);
      } catch (err) {
        console.error('Failed to fetch history:', err);
      }
    };
    fetchHistory();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await apiCall<VerificationResult>('/verification/verify', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(res);
      setStep('result');
      setHistory((prev) => [res, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const renderMetrics = (label: string, value: number, max = 100, unit = '%') => (
    <div className="flex items-center justify-between p-2 border rounded">
      <span className="text-sm">{label}</span>
      <span className="font-mono text-sm font-medium">
        {unit === '%' ? `${Math.min(value, max)}${unit}` : value}
      </span>
    </div>
  );

  if (step === 'result' && result) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Verification Result</h1>
          <Button variant="outline" onClick={() => setStep('form')}>New Verification</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Score: {result.score}/100</span>
              <Badge className={statusColors[result.status]}>{result.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{result.summary}</p>
            <p className="text-xs text-muted-foreground">
              Verified: {new Date(result.verifiedAt).toLocaleString()}
            </p>

            {result.details.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Details</p>
                <ul className="space-y-1">
                  {result.details.map((d, i) => (
                    <li key={i} className="text-sm text-muted-foreground">- {d}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {result.codeQuality && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Code Quality Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {renderMetrics('Lines of Code', result.codeQuality.linesOfCode, Infinity, '')}
              {renderMetrics('Test Coverage', result.codeQuality.testCoverage)}
              {renderMetrics('Documentation Coverage', result.codeQuality.documentationCoverage)}
              {renderMetrics('Maintainability Index', result.codeQuality.maintainabilityIndex)}
              {renderMetrics('Duplicate Code', result.codeQuality.duplicateCodeRatio * 100)}
              {renderMetrics('Cyclomatic Complexity', result.codeQuality.cyclomaticComplexity, Infinity, '')}
            </CardContent>
          </Card>
        )}

        {result.plagiarism && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plagiarism Detection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded">
                <span className="text-sm font-medium">Overall Similarity</span>
                <Badge className={result.plagiarism.overallSimilarity > 30 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                  {result.plagiarism.overallSimilarity}%
                </Badge>
              </div>

              {result.plagiarism.externalMatches.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">External Matches</p>
                  <div className="space-y-2">
                    {result.plagiarism.externalMatches.map((match, i) => (
                      <div key={i} className="p-2 border rounded text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-mono">{match.repository}</span>
                          <span className="text-muted-foreground">{match.similarity}%</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{match.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Work Verification</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analyze code quality, detect plagiarism, and verify milestone completion.
          </p>
        </div>
        {history.length > 0 && (
          <Button variant="outline" onClick={() => setStep('history')}>
            History ({history.length})
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verification Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Repository URL</Label>
              <Input
                type="url"
                value={form.repositoryUrl}
                onChange={(e) => setForm({ ...form, repositoryUrl: e.target.value })}
                placeholder="https://github.com/owner/repo"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Project ID</Label>
              <Input
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                placeholder="Enter project ID"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Milestone Description</Label>
              <textarea
                value={form.milestoneDescription}
                onChange={(e) => setForm({ ...form, milestoneDescription: e.target.value })}
                placeholder="Describe what the milestone requires..."
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[100px]"
                required
              />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Analyzing...' : 'Run AI Verification'}
        </Button>
      </form>

      {step === 'history' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verification History</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No verifications yet.</p>
            ) : (
              <div className="space-y-3">
                {history.map((v) => (
                  <div
                    key={v.id}
                    className="p-3 border rounded cursor-pointer hover:bg-gray-50"
                    onClick={() => { setResult(v); setStep('result'); }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{v.projectId}</p>
                        <p className="text-xs text-muted-foreground">{v.summary}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{v.score}/100</span>
                        <Badge className={statusColors[v.status]}>{v.status}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
