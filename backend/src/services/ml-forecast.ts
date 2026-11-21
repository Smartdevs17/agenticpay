// Revenue Forecasting with ML — Issue #854
// Ensemble ML forecasting: linear regression, polynomial, exponential smoothing, moving average with model selection.

export interface HistoricalPoint {
  timestamp: string;
  value: number;
}

export interface ForecastPointML {
  timestamp: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
  model: string;
}

export interface ModelPerformance {
  model: string;
  mae: number;
  rmse: number;
  mape: number;
  r2: number;
  bias: number;
}

export interface MLForecastResult {
  historical: HistoricalPoint[];
  forecast: ForecastPointML[];
  models: ModelPerformance[];
  bestModel: string;
  confidence: 'low' | 'medium' | 'high';
  trend: 'up' | 'down' | 'stable';
  seasonalityDetected: boolean;
  seasonalityPeriod: number | null;
  summary: {
    next7Days: number;
    next30Days: number;
    next90Days: number;
  };
  accuracy: ModelPerformance | null;
  generatedAt: string;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function variance(arr: number[]): number {
  const m = mean(arr);
  return arr.length ? arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length : 0;
}

function std(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: mean(y), r2: 0 };
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const ssRes = y.reduce((s, yi, i) => s + (yi - (slope * x[i] + intercept)) ** 2, 0);
  const ssTot = y.reduce((s, yi) => s + (yi - my) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function polynomialRegression(x: number[], y: number[], degree = 2): { coeffs: number[]; r2: number } {
  // normal equation via Vandermonde for degree 2 (3 coeffs) using closed form
  const n = x.length;
  if (n < degree + 1) return { coeffs: [mean(y)], r2: 0 };
  // Build X^T X and X^T y for degree 2
  // Solve 3x3 linear system using Cramer's rule / gaussian elimination
  const sx = [0, 0, 0, 0, 0]; // sums x^i
  const sxy = [0, 0, 0]; // sums x^i * y
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    let pow = 1;
    for (let k = 0; k < 2 * degree + 1; k++) {
      if (k < sx.length) sx[k] += pow;
      pow *= xi;
    }
    pow = 1;
    for (let k = 0; k <= degree; k++) {
      sxy[k] += pow * yi;
      pow *= xi;
    }
  }
  // matrix A 3x3
  const A = [
    [sx[0], sx[1], sx[2]],
    [sx[1], sx[2], sx[3]],
    [sx[2], sx[3], sx[4]],
  ];
  const b = [sxy[0], sxy[1], sxy[2]];
  const coeffs = solve3x3(A, b);
  if (!coeffs) return { coeffs: [mean(y)], r2: 0 };
  const pred = x.map((xi) => coeffs[0] + coeffs[1] * xi + coeffs[2] * xi * xi);
  const my = mean(y);
  const ssRes = y.reduce((s, yi, i) => s + (yi - pred[i]) ** 2, 0);
  const ssTot = y.reduce((s, yi) => s + (yi - my) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { coeffs, r2 };
}

function solve3x3(A: number[][], b: number[]): number[] | null {
  // Gaussian elimination
  const M = A.map((row, i) => [...row, b[i]]);
  const n = 3;
  for (let i = 0; i < n; i++) {
    // pivot
    let maxRow = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) maxRow = r;
    if (Math.abs(M[maxRow][i]) < 1e-12) return null;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    for (let r = i + 1; r < n; r++) {
      const factor = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= factor * M[i][c];
    }
  }
  const x = [0, 0, 0];
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x;
}

function exponentialSmoothing(data: number[], alpha = 0.3): number[] {
  if (data.length === 0) return [];
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

function holtWinters(data: number[], alpha = 0.3, beta = 0.1, gamma = 0.1, period = 7, horizon = 30): number[] {
  if (data.length < period * 2) {
    // fallback to exponential smoothing + linear trend
    const smoothed = exponentialSmoothing(data, alpha);
    const x = data.map((_, i) => i);
    const { slope, intercept } = linearRegression(x, smoothed);
    const lastX = x[x.length - 1] ?? 0;
    return Array.from({ length: horizon }, (_, i) => Math.max(0, slope * (lastX + i + 1) + intercept));
  }
  // Initialize level, trend, seasonal
  const seasons = period;
  const level: number[] = [];
  const trend: number[] = [];
  const seasonal: number[] = Array(seasons).fill(0);

  // initial seasonal components
  const avgFirst = mean(data.slice(0, seasons));
  const avgSecond = mean(data.slice(seasons, seasons * 2));
  for (let i = 0; i < seasons; i++) {
    seasonal[i] = avgFirst > 0 ? (data[i] - avgFirst) : 0;
  }
  level[0] = avgFirst;
  trend[0] = (avgSecond - avgFirst) / seasons;

  for (let i = 0; i < data.length; i++) {
    const seasonIdx = i % seasons;
    if (i === 0) continue;
    const prevLevel = level[i - 1];
    const prevTrend = trend[i - 1];
    const prevSeason = seasonal[seasonIdx];
    const curLevel = alpha * (data[i] - prevSeason) + (1 - alpha) * (prevLevel + prevTrend);
    const curTrend = beta * (curLevel - prevLevel) + (1 - beta) * prevTrend;
    const curSeason = gamma * (data[i] - curLevel) + (1 - gamma) * prevSeason;
    level[i] = curLevel;
    trend[i] = curTrend;
    seasonal[seasonIdx] = curSeason;
  }

  const lastLevel = level[level.length - 1];
  const lastTrend = trend[trend.length - 1];
  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const seasonIdx = (data.length + h - 1) % seasons;
    const val = (lastLevel + h * lastTrend) + seasonal[seasonIdx];
    forecast.push(Math.max(0, val));
  }
  return forecast;
}

function movingAverageForecast(data: number[], window = 7, horizon = 30): number[] {
  if (data.length === 0) return Array(horizon).fill(0);
  const result: number[] = [];
  let buffer = [...data];
  for (let i = 0; i < horizon; i++) {
    const start = Math.max(0, buffer.length - window);
    const avg = mean(buffer.slice(start));
    result.push(avg);
    buffer.push(avg);
  }
  return result;
}

function computeAccuracy(actual: number[], predicted: number[]): ModelPerformance {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return { model: 'unknown', mae: 0, rmse: 0, mape: 0, r2: 0, bias: 0 };
  const a = actual.slice(0, n);
  const p = predicted.slice(0, n);
  const mae = mean(a.map((v, i) => Math.abs(v - p[i])));
  const rmse = Math.sqrt(mean(a.map((v, i) => (v - p[i]) ** 2)));
  const mape = mean(a.map((v, i) => (v !== 0 ? Math.abs((v - p[i]) / v) : 0))) * 100;
  const bias = mean(a.map((v, i) => p[i] - v));
  const my = mean(a);
  const ssRes = a.reduce((s, v, i) => s + (v - p[i]) ** 2, 0);
  const ssTot = a.reduce((s, v) => s + (v - my) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { model: 'unknown', mae, rmse, mape, r2, bias };
}

function detectSeasonality(data: number[], maxPeriod = 30): { detected: boolean; period: number | null; strength: number } {
  if (data.length < maxPeriod * 2) return { detected: false, period: null, strength: 0 };
  let bestPeriod: number | null = null;
  let bestScore = 0;
  for (let p = 2; p <= Math.min(maxPeriod, Math.floor(data.length / 2)); p++) {
    // autocorrelation at lag p
    const lagVals: number[] = [];
    const origVals: number[] = [];
    for (let i = p; i < data.length; i++) {
      lagVals.push(data[i]);
      origVals.push(data[i - p]);
    }
    const m1 = mean(origVals);
    const m2 = mean(lagVals);
    let num = 0;
    let d1 = 0;
    let d2 = 0;
    for (let i = 0; i < lagVals.length; i++) {
      num += (origVals[i] - m1) * (lagVals[i] - m2);
      d1 += (origVals[i] - m1) ** 2;
      d2 += (lagVals[i] - m2) ** 2;
    }
    const denom = Math.sqrt(d1 * d2);
    const corr = denom === 0 ? 0 : num / denom;
    if (corr > bestScore) {
      bestScore = corr;
      bestPeriod = p;
    }
  }
  return { detected: bestScore > 0.5, period: bestPeriod, strength: bestScore };
}

export class MLForecastService {
  // cross-validate models and pick best by RMSE on last 20% holdout
  evaluateModels(historical: number[]): ModelPerformance[] {
    if (historical.length < 10) return [];
    const split = Math.floor(historical.length * 0.8);
    const train = historical.slice(0, split);
    const test = historical.slice(split);
    const horizon = test.length;

    const models: Array<{ name: string; predict: () => number[] }> = [
      {
        name: 'linear_regression',
        predict: () => {
          const x = train.map((_, i) => i);
          const { slope, intercept } = linearRegression(x, train);
          return test.map((_, i) => Math.max(0, slope * (split + i) + intercept));
        },
      },
      {
        name: 'polynomial',
        predict: () => {
          const x = train.map((_, i) => i);
          const { coeffs } = polynomialRegression(x, train, 2);
          return test.map((_, i) => {
            const xi = split + i;
            return Math.max(0, coeffs[0] + coeffs[1] * xi + coeffs[2] * xi * xi);
          });
        },
      },
      {
        name: 'exponential_smoothing',
        predict: () => {
          const smoothed = exponentialSmoothing(train, 0.3);
          const last = smoothed[smoothed.length - 1] ?? train[train.length - 1];
          // simple drift from last trend
          const trend = train.length > 1 ? (train[train.length - 1] - train[0]) / (train.length - 1) : 0;
          return Array(horizon)
            .fill(0)
            .map((_, i) => Math.max(0, last + trend * (i + 1) * 0.5));
        },
      },
      {
        name: 'holt_winters',
        predict: () => holtWinters(train, 0.3, 0.1, 0.1, 7, horizon),
      },
      {
        name: 'moving_average',
        predict: () => movingAverageForecast(train, 7, horizon),
      },
    ];

    return models.map((m) => {
      const pred = m.predict();
      const acc = computeAccuracy(test, pred);
      return { ...acc, model: m.name };
    });
  }

  forecast(historical: HistoricalPoint[], horizon = 30): MLForecastResult {
    const values = historical.map((h) => h.value);
    const timestamps = historical.map((h) => h.timestamp);

    if (values.length < 2) {
      return {
        historical,
        forecast: [],
        models: [],
        bestModel: 'none',
        confidence: 'low',
        trend: 'stable',
        seasonalityDetected: false,
        seasonalityPeriod: null,
        summary: { next7Days: 0, next30Days: 0, next90Days: 0 },
        accuracy: null,
        generatedAt: new Date().toISOString(),
      };
    }

    const performances = this.evaluateModels(values);
    const best = performances.length ? [...performances].sort((a, b) => a.rmse - b.rmse)[0] : null;
    const bestModel = best?.model ?? 'linear_regression';

    const seasonality = detectSeasonality(values, 30);

    // Generate forecasts from best model
    let forecastValues: number[];
    let residualStd = 0;

    // Compute residual std from training
    if (best) {
      // estimate residual std as RMSE of best
      residualStd = best.rmse;
    } else {
      residualStd = std(values) * 0.3;
    }

    switch (bestModel) {
      case 'linear_regression': {
        const x = values.map((_, i) => i);
        const { slope, intercept } = linearRegression(x, values);
        forecastValues = Array.from({ length: horizon }, (_, i) => Math.max(0, slope * (values.length + i) + intercept));
        break;
      }
      case 'polynomial': {
        const x = values.map((_, i) => i);
        const { coeffs } = polynomialRegression(x, values, 2);
        forecastValues = Array.from({ length: horizon }, (_, i) => {
          const xi = values.length + i;
          return Math.max(0, coeffs[0] + coeffs[1] * xi + coeffs[2] * xi * xi);
        });
        break;
      }
      case 'holt_winters': {
        forecastValues = holtWinters(values, 0.3, 0.1, 0.1, seasonality.period ?? 7, horizon);
        break;
      }
      case 'moving_average': {
        forecastValues = movingAverageForecast(values, 7, horizon);
        break;
      }
      case 'exponential_smoothing': {
        const smoothed = exponentialSmoothing(values, 0.3);
        const last = smoothed[smoothed.length - 1] ?? values[values.length - 1];
        const trend = values.length > 1 ? (values[values.length - 1] - values[0]) / (values.length - 1) : 0;
        forecastValues = Array.from({ length: horizon }, (_, i) => Math.max(0, last + trend * (i + 1) * 0.5));
        break;
      }
      default: {
        const x = values.map((_, i) => i);
        const { slope, intercept } = linearRegression(x, values);
        forecastValues = Array.from({ length: horizon }, (_, i) => Math.max(0, slope * (values.length + i) + intercept));
      }
    }

    // Ensemble smoothing: blend with moving average 20%
    const maForecast = movingAverageForecast(values, 7, horizon);
    forecastValues = forecastValues.map((v, i) => v * 0.85 + maForecast[i] * 0.15);

    // Build forecast points
    const lastDate = historical.length ? new Date(historical[historical.length - 1].timestamp) : new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const forecast: ForecastPointML[] = forecastValues.map((val, i) => {
      const d = new Date(lastDate.getTime() + (i + 1) * dayMs);
      const ts = d.toISOString().slice(0, 10);
      const rounded = Math.round(val * 100) / 100;
      const margin = residualStd > 0 ? 1.96 * residualStd : rounded * 0.2;
      return {
        timestamp: ts,
        predicted: rounded,
        lowerBound: Math.max(0, Math.round((rounded - margin) * 100) / 100),
        upperBound: Math.round((rounded + margin) * 100) / 100,
        model: bestModel,
      };
    });

    // Confidence based on best R2
    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (best) {
      if (best.r2 > 0.7) confidence = 'high';
      else if (best.r2 > 0.3) confidence = 'medium';
    }

    // Trend from linear slope
    const xAll = values.map((_, i) => i);
    const { slope } = linearRegression(xAll, values);
    const avgVal = mean(values);
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (Math.abs(slope) > avgVal * 0.005) {
      trend = slope > 0 ? 'up' : 'down';
    }

    const next7 = forecast.slice(0, 7).reduce((s, f) => s + f.predicted, 0);
    const next30 = forecast.slice(0, 30).reduce((s, f) => s + f.predicted, 0);
    const next90 = forecast.reduce((s, f) => s + f.predicted, 0);

    // attach model names to performances for accuracy
    const accuracy = best ? { ...best } : null;

    // include original timestamps fallback if historical timestamps not daily
    void timestamps;

    return {
      historical,
      forecast,
      models: performances,
      bestModel,
      confidence,
      trend,
      seasonalityDetected: seasonality.detected,
      seasonalityPeriod: seasonality.period,
      summary: {
        next7Days: Math.round(next7 * 100) / 100,
        next30Days: Math.round(next30 * 100) / 100,
        next90Days: Math.round(next90 * 100) / 100,
      },
      accuracy,
      generatedAt: new Date().toISOString(),
    };
  }

  // Feature engineering helper
  buildFeatures(values: number[], window = 7): Array<Record<string, number>> {
    const features: Array<Record<string, number>> = [];
    for (let i = window; i < values.length; i++) {
      const slice = values.slice(i - window, i);
      features.push({
        lag1: values[i - 1],
        lag7: i >= 7 ? values[i - 7] : values[i - 1],
        rollingMean: mean(slice),
        rollingStd: std(slice),
        momentum: values[i - 1] - slice[0],
        value: values[i],
      });
    }
    return features;
  }

  detectAnomaliesInForecast(actual: number[], predicted: number[], thresholdStd = 2): number[] {
    const residuals = actual.map((v, i) => Math.abs(v - (predicted[i] ?? v)));
    const m = mean(residuals);
    const s = std(residuals);
    const out: number[] = [];
    for (let i = 0; i < actual.length; i++) {
      if (Math.abs(actual[i] - (predicted[i] ?? actual[i])) > m + thresholdStd * s) out.push(i);
    }
    return out;
  }
}

export const mlForecastService = new MLForecastService();
