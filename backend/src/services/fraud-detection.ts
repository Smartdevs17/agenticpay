import { randomUUID } from 'node:crypto';

export interface TransactionSample {
  transactionId: string;
  accountAgeDays: number;
  amountUsd: number;
  velocity1h: number;
  geoDistanceKm: number;
  deviceRisk: number;
  failedAttempts24h: number;
  chargebacks90d: number;
}

export interface LabeledSample extends TransactionSample {
  label: 0 | 1;
}

export interface FraudScoringResult {
  transactionId: string;
  riskScore: number;
  action: 'allow' | 'review' | 'block';
  reasons: string[];
}

type Thresholds = {
  review: number;
  block: number;
};

type ModelState = {
  weights: number[];
  bias: number;
  trainedSamples: number;
  updatedAt: string;
  version: string;
};

type ReviewItem = {
  id: string;
  transactionId: string;
  riskScore: number;
  createdAt: string;
  payload: TransactionSample;
};

const FEATURE_NAMES = [
  'accountAgeDays',
  'amountUsd',
  'velocity1h',
  'geoDistanceKm',
  'deviceRisk',
  'failedAttempts24h',
  'chargebacks90d',
] as const;

let thresholds: Thresholds = { review: 0.45, block: 0.8 };

let model: ModelState = {
  weights: [0.05, 0.2, 0.1, 0.08, 0.25, 0.12, 0.2],
  bias: -1.2,
  trainedSamples: 0,
  updatedAt: new Date().toISOString(),
  version: 'v1-bootstrap',
};

const reviewQueue: ReviewItem[] = [];

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function normalize(sample: TransactionSample): number[] {
  return [
    Math.min(sample.accountAgeDays / 365, 1),
    Math.min(sample.amountUsd / 10_000, 1),
    Math.min(sample.velocity1h / 100, 1),
    Math.min(sample.geoDistanceKm / 20_000, 1),
    Math.min(Math.max(sample.deviceRisk, 0), 1),
    Math.min(sample.failedAttempts24h / 20, 1),
    Math.min(sample.chargebacks90d / 10, 1),
  ];
}

function dot(a: number[], b: number[]): number {
  return a.reduce((acc, cur, idx) => acc + cur * b[idx], 0);
}

export function engineerFeatures(sample: TransactionSample): Record<string, number> {
  const normalized = normalize(sample);
  return FEATURE_NAMES.reduce<Record<string, number>>((acc, name, idx) => {
    acc[name] = normalized[idx];
    return acc;
  }, {});
}

export function scoreTransaction(sample: TransactionSample): FraudScoringResult {
  const features = normalize(sample);
  const raw = dot(features, model.weights) + model.bias;
  const riskScore = Number(sigmoid(raw).toFixed(6));

  const contributions = features
    .map((value, idx) => ({
      feature: FEATURE_NAMES[idx],
      contribution: value * model.weights[idx],
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map((x) => `${x.feature}:${x.contribution.toFixed(3)}`);

  let action: FraudScoringResult['action'] = 'allow';
  if (riskScore >= thresholds.block) action = 'block';
  else if (riskScore >= thresholds.review) action = 'review';

  if (action === 'review') {
    reviewQueue.unshift({
      id: `fraud_review_${randomUUID()}`,
      transactionId: sample.transactionId,
      riskScore,
      createdAt: new Date().toISOString(),
      payload: sample,
    });
  }

  return {
    transactionId: sample.transactionId,
    riskScore,
    action,
    reasons: contributions,
  };
}

export function updateThresholds(next: Partial<Thresholds>): Thresholds {
  if (typeof next.review === 'number') thresholds.review = next.review;
  if (typeof next.block === 'number') thresholds.block = next.block;
  if (thresholds.review >= thresholds.block) {
    thresholds = { review: 0.45, block: 0.8 };
  }
  return { ...thresholds };
}

export function getThresholds(): Thresholds {
  return { ...thresholds };
}

export function trainModel(samples: LabeledSample[], learningRate = 0.3, epochs = 100): ModelState {
  if (samples.length === 0) return model;

  const weights = [...model.weights];
  let bias = model.bias;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const sample of samples) {
      const x = normalize(sample);
      const y = sample.label;
      const pred = sigmoid(dot(x, weights) + bias);
      const error = pred - y;
      for (let i = 0; i < weights.length; i++) {
        weights[i] -= learningRate * error * x[i];
      }
      bias -= learningRate * error;
    }
  }

  model = {
    weights,
    bias,
    trainedSamples: model.trainedSamples + samples.length,
    updatedAt: new Date().toISOString(),
    version: `v1-${Date.now()}`,
  };
  return model;
}

export function runAdversarialRobustnessProbe(sample: TransactionSample): {
  baseline: FraudScoringResult;
  perturbed: FraudScoringResult;
  delta: number;
} {
  const baseline = scoreTransaction(sample);
  const perturbed = scoreTransaction({
    ...sample,
    amountUsd: sample.amountUsd * 0.98,
    velocity1h: Math.max(0, sample.velocity1h - 1),
    deviceRisk: Math.max(0, sample.deviceRisk - 0.02),
  });
  return {
    baseline,
    perturbed,
    delta: Number((baseline.riskScore - perturbed.riskScore).toFixed(6)),
  };
}

export function getReviewQueue(): ReviewItem[] {
  return [...reviewQueue];
}

export function getModelState(): ModelState {
  return { ...model, weights: [...model.weights] };
}
