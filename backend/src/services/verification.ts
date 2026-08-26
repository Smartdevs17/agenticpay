import OpenAI from 'openai';
import { config } from '../config/env.js';

let openaiClient: OpenAI | null = null;

const getOpenAIClient = () => {
  const apiKey = config().OPENAI_API_KEY;

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

export interface CodeQualityMetrics {
  linesOfCode: number;
  testCoverage: number;
  cyclomaticComplexity: number;
  documentationCoverage: number;
  duplicateCodeRatio: number;
  maintainabilityIndex: number;
}

export interface PlagiarismResult {
  overallSimilarity: number;
  duplicateSegments: Array<{
    source: string;
    similarity: number;
    lines: string;
  }>;
  externalMatches: Array<{
    repository: string;
    similarity: number;
    description: string;
  }>;
}

interface VerificationRequest {
  repositoryUrl: string;
  milestoneDescription: string;
  projectId: string;
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

export type VerificationUpdate = {
  id: string;
  status?: 'passed' | 'failed' | 'pending';
  score?: number;
  summary?: string;
  details?: string[];
};

import { withQueryProfiling } from '../config/database.js';

// In-memory store (replace with DB in production)
const verifications = new Map<string, VerificationResult>();

async function fetchGitHubRepoContents(repoUrl: string): Promise<string> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return '';

  const [, owner, repo] = match;
  const token = config().GITHUB_TOKEN;

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) headers.Authorization = `token ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
      { headers }
    );
    if (!res.ok) return '';
    const data = await res.json() as { tree?: Array<{ path: string; size?: number; type: string }> };
    const files = (data.tree || []).filter(
      (f: { type: string }) => f.type === 'blob'
    ).slice(0, 50);

    const contents: string[] = [];
    for (const file of files) {
      if (
        /\.(ts|tsx|js|jsx|py|go|rs|java|rb|css|html|json|md|yaml|yml|toml)$/i.test(file.path) &&
        (file.size || 0) < 50_000
      ) {
        try {
          const fileRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`,
            { headers }
          );
          if (fileRes.ok) {
            const fileData = await fileRes.json() as { content?: string; encoding?: string };
            if (fileData.content && fileData.encoding === 'base64') {
              contents.push(`--- ${file.path} ---\n${Buffer.from(fileData.content, 'base64').toString('utf-8')}`);
            }
          }
        } catch {
          // Skip files that can't be fetched
        }
      }
    }

    return contents.join('\n\n');
  } catch {
    return '';
  }
}

export async function verifyWork(request: VerificationRequest): Promise<VerificationResult> {
  const id = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const repoContents = await fetchGitHubRepoContents(request.repositoryUrl);

  const codeQuality = analyzeCodeQuality(repoContents);
  const plagiarism = await detectPlagiarism(repoContents, request.repositoryUrl);

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a senior code reviewer and quality assurance expert. Given repository contents and a milestone description, provide a thorough verification assessment.

Analyze:
1. Whether the code fulfills the milestone requirements
2. Code quality (readability, structure, patterns)
3. Test coverage adequacy
4. Security considerations
5. Documentation completeness

Respond with a JSON object containing:
- score (0-100, weighted: 40% requirement fulfillment, 25% code quality, 20% test coverage, 15% documentation)
- summary (one sentence overall assessment)
- details (array of specific observations, both positive and negative)
- recommendation (approve, request_changes, or needs_review)`,
      },
      {
        role: 'user',
        content: `Repository: ${request.repositoryUrl}
Milestone: ${request.milestoneDescription}

Code Quality Metrics:
- Lines of Code: ${codeQuality.linesOfCode}
- Cyclomatic Complexity: ${codeQuality.cyclomaticComplexity}
- Documentation Coverage: ${codeQuality.documentationCoverage}%
- Duplicate Code Ratio: ${codeQuality.duplicateCodeRatio}%
- Maintainability Index: ${codeQuality.maintainabilityIndex}

Plagiarism Analysis:
- Overall Similarity: ${plagiarism.overallSimilarity}%
- External Matches: ${plagiarism.externalMatches.length}

${repoContents ? `Repository Contents:\n${repoContents.slice(0, 8000)}` : 'Repository contents could not be fetched.'}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const assessment = JSON.parse(completion.choices[0].message.content || '{}');

  const result: VerificationResult = {
    id,
    projectId: request.projectId,
    status: (assessment.score || 0) >= 70 ? 'passed' : 'failed',
    score: assessment.score || 0,
    summary: assessment.summary || 'Verification completed',
    details: assessment.details || [],
    verifiedAt: new Date().toISOString(),
    codeQuality,
    plagiarism,
  };

  storeVerification(result);
  return result;
}

function analyzeCodeQuality(contents: string): CodeQualityMetrics {
  if (!contents) {
    return {
      linesOfCode: 0,
      testCoverage: 0,
      cyclomaticComplexity: 0,
      documentationCoverage: 0,
      duplicateCodeRatio: 0,
      maintainabilityIndex: 0,
    };
  }

  const lines = contents.split('\n');
  const codeLines = lines.filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#'));
  const commentLines = lines.filter((l) => l.trim().startsWith('//') || l.trim().startsWith('#') || l.trim().startsWith('*'));
  const testLines = lines.filter((l) => /test|spec|describe|it\(|expect\(/i.test(l));

  const complexityIndicators = contents.match(
    /\b(if|else|elif|else if|for|while|switch|case|catch|try|&&|\|\||\?)\b/g
  );

  const uniqueLines = new Set(codeLines.map((l) => l.trim()));
  const duplicateRatio = codeLines.length > 0 ? 1 - uniqueLines.size / codeLines.length : 0;

  const linesOfCode = codeLines.length;
  const documentationCoverage = linesOfCode > 0 ? Math.min(100, (commentLines.length / linesOfCode) * 100 * 3) : 0;
  const testCoverage = linesOfCode > 0 ? Math.min(100, (testLines.length / linesOfCode) * 100 * 5) : 0;
  const cyclomaticComplexity = Math.min(100, (complexityIndicators?.length || 0) / Math.max(1, linesOfCode / 50));
  const maintainabilityIndex = Math.max(0, Math.min(100,
    100 - cyclomaticComplexity * 2 - duplicateRatio * 30 + documentationCoverage * 0.3
  ));

  return {
    linesOfCode,
    testCoverage: Math.round(testCoverage),
    cyclomaticComplexity: Math.round(cyclomaticComplexity * 10) / 10,
    documentationCoverage: Math.round(documentationCoverage),
    duplicateCodeRatio: Math.round(duplicateRatio * 100) / 100,
    maintainabilityIndex: Math.round(maintainabilityIndex),
  };
}

async function detectPlagiarism(contents: string, repoUrl: string): Promise<PlagiarismResult> {
  if (!contents) {
    return {
      overallSimilarity: 0,
      duplicateSegments: [],
      externalMatches: [],
    };
  }

  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Analyze the following code for potential plagiarism indicators. Look for:
1. Common open-source code patterns that might indicate copying
2. Boilerplate code vs original implementation
3. Suspiciously similar implementations to well-known projects

Respond with JSON containing:
- overallSimilarity (0-100 percentage estimate of non-original code)
- duplicateSegments (array of {source, similarity, lines} for code blocks that look copied)
- externalMatches (array of {repository, similarity, description} for potential matches to public repos)`,
        },
        {
          role: 'user',
          content: `Repository: ${repoUrl}\n\nCode to analyze:\n${contents.slice(0, 6000)}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const analysis = JSON.parse(completion.choices[0].message.content || '{}');
    return {
      overallSimilarity: analysis.overallSimilarity || 0,
      duplicateSegments: analysis.duplicateSegments || [],
      externalMatches: analysis.externalMatches || [],
    };
  } catch {
    return {
      overallSimilarity: 0,
      duplicateSegments: [],
      externalMatches: [],
    };
  }
}

export function storeVerification(result: VerificationResult): void {
  verifications.set(result.id, result);
}

export async function getVerification(id: string): Promise<VerificationResult | undefined> {
  return withQueryProfiling(
    'SELECT * FROM verifications WHERE id = ?',
    'verification.service',
    async () => verifications.get(id),
  );
}

export function listVerifications(projectId?: string): VerificationResult[] {
  const all = [...verifications.values()];
  if (projectId) return all.filter((v) => v.projectId === projectId);
  return all;
}

export function updateVerification(update: VerificationUpdate): VerificationResult | undefined {
  const current = verifications.get(update.id);
  if (!current) {
    return undefined;
  }

  const updated: VerificationResult = {
    ...current,
    status: update.status ?? current.status,
    score: update.score ?? current.score,
    summary: update.summary ?? current.summary,
    details: update.details ?? current.details,
    verifiedAt: new Date().toISOString(),
  };

  verifications.set(update.id, updated);
  return updated;
}

export function deleteVerification(id: string): boolean {
  return verifications.delete(id);
}
