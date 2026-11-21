import { gasPriceHistory } from '../gas.js';

export type PredictionHorizon = '1min' | '5min' | '15min';

// Smoothing factors: higher α = more weight on recent samples (shorter horizon).
const ALPHA: Record<PredictionHorizon, number> = {
  '1min': 0.30,
  '5min': 0.15,
  '15min': 0.05,
};

export interface GasPricePrediction {
  horizon: PredictionHorizon;
  predictedGwei: number;
  confidence: 'high' | 'medium' | 'low';
  basedOnSamples: number;
}

function ewma(values: number[], alpha: number): number {
  if (values.length === 0) return 0;
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = alpha * values[i] + (1 - alpha) * result;
  }
  return result;
}

function confidenceLevel(sampleCount: number): GasPricePrediction['confidence'] {
  if (sampleCount >= 20) return 'high';
  if (sampleCount >= 5) return 'medium';
  return 'low';
}

export function predictGasPrice(horizon: PredictionHorizon): GasPricePrediction {
  const samples = gasPriceHistory.getSamples();
  // Sort ascending by timestamp so EWMA applies chronologically.
  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const fees = sorted.map((s) => s.baseFeeGwei);

  const predictedGwei = fees.length > 0 ? ewma(fees, ALPHA[horizon]) : 10;

  return {
    horizon,
    predictedGwei: Math.round(predictedGwei * 100) / 100,
    confidence: confidenceLevel(fees.length),
    basedOnSamples: fees.length,
  };
}

export function predictAll(): GasPricePrediction[] {
  return (['1min', '5min', '15min'] as PredictionHorizon[]).map(predictGasPrice);
}
