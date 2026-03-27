import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'The OPENAI_API_KEY environment variable is missing or empty; provide it to run verification.'
    );
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

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
}

export type VerificationUpdate = {
  id: string;
  status?: 'passed' | 'failed' | 'pending';
  score?: number;
  summary?: string;
  details?: string[];
};

// In-memory store (replace with DB in production)
const verifications = new Map<string, VerificationResult>();

export async function verifyWork(request: VerificationRequest): Promise<VerificationResult> {
  const id = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // TODO: Fetch actual repo contents via GitHub API
  // For now, use AI to generate a verification assessment

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a code reviewer. Given a milestone description and repository URL, assess whether the work likely meets the requirements. Respond with a JSON object containing: score (0-100), summary (one sentence), details (array of specific observations).',
      },
      {
        role: 'user',
        content: `Repository: ${request.repositoryUrl}\nMilestone: ${request.milestoneDescription}`,
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
  };

  storeVerification(result);
  return result;
}

export function storeVerification(result: VerificationResult): void {
  verifications.set(result.id, result);
}

export async function getVerification(id: string): Promise<VerificationResult | undefined> {
  return verifications.get(id);
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
