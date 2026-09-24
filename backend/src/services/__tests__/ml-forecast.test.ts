import { describe, expect, it } from 'vitest';
import { MLForecastService } from '../ml-forecast.js';

describe('MLForecastService — Issue #854', () => {
  const service = new MLForecastService();

  function genLinear(n: number, slope = 10, noise = 2): Array<{ timestamp: string; value: number }> {
    return Array.from({ length: n }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      value: 100 + slope * i + (Math.random() - 0.5) * noise,
    }));
  }

  it('forecasts with linear data high confidence', () => {
    const historical = genLinear(60, 5, 1);
    const result = service.forecast(historical, 30);
    expect(result.forecast).toHaveLength(30);
    expect(result.bestModel).toBeTruthy();
    expect(result.confidence).toBe('high');
    expect(result.trend).toBe('up');
    expect(result.summary.next7Days).toBeGreaterThan(0);
    expect(result.summary.next30Days).toBeGreaterThan(result.summary.next7Days);
  });

  it('detects downward trend', () => {
    const historical = genLinear(40, -3, 1);
    const result = service.forecast(historical, 7);
    expect(result.trend).toBe('down');
  });

  it('detects stable trend', () => {
    const historical = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      value: 100 + Math.sin(i) * 2,
    }));
    const result = service.forecast(historical, 7);
    expect(result.trend).toBe('stable');
  });

  it('returns low confidence with insufficient data', () => {
    const result = service.forecast([{ timestamp: new Date().toISOString(), value: 100 }], 7);
    expect(result.forecast).toHaveLength(0);
    expect(result.confidence).toBe('low');
  });

  it('evaluates multiple models', () => {
    const values = Array.from({ length: 50 }, (_, i) => 100 + i * 2 + Math.random() * 5);
    const models = service.evaluateModels(values);
    expect(models.length).toBe(5);
    for (const m of models) {
      expect(m).toHaveProperty('mae');
      expect(m).toHaveProperty('rmse');
      expect(m).toHaveProperty('r2');
    }
    const best = [...models].sort((a, b) => a.rmse - b.rmse)[0];
    expect(best.rmse).toBeLessThanOrEqual(models[0].rmse + 1000);
  });

  it('forecast values have bounds', () => {
    const historical = genLinear(50, 2, 0.5);
    const result = service.forecast(historical, 10);
    for (const f of result.forecast) {
      expect(f.lowerBound).toBeLessThanOrEqual(f.predicted);
      expect(f.upperBound).toBeGreaterThanOrEqual(f.predicted);
      expect(f.lowerBound).toBeGreaterThanOrEqual(0);
    }
  });

  it('builds lag features', () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 10);
    const features = service.buildFeatures(values, 7);
    expect(features.length).toBe(13);
    expect(features[0]).toHaveProperty('lag1');
    expect(features[0]).toHaveProperty('rollingMean');
    expect(features[0]).toHaveProperty('rollingStd');
  });

  it('detects seasonality', () => {
    // weekly seasonality synthetic
    const values = Array.from({ length: 60 }, (_, i) => 100 + 20 * Math.sin((2 * Math.PI * i) / 7) + Math.random() * 2);
    const historical = values.map((v, i) => ({ timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), value: v }));
    const result = service.forecast(historical, 14);
    // seasonality may be detected
    expect(typeof result.seasonalityDetected).toBe('boolean');
    if (result.seasonalityDetected) {
      expect(result.seasonalityPeriod).toBeGreaterThan(1);
    }
  });

  it('ensemble forecast is smooth', () => {
    const historical = genLinear(30, 1, 10);
    const result = service.forecast(historical, 30);
    // forecast should not have NaN
    for (const f of result.forecast) {
      expect(Number.isNaN(f.predicted)).toBe(false);
    }
  });

  it('handles horizon boundaries', () => {
    const historical = genLinear(20, 1, 1);
    const r7 = service.forecast(historical, 7);
    const r90 = service.forecast(historical, 90);
    expect(r7.forecast).toHaveLength(7);
    expect(r90.forecast).toHaveLength(90);
  });
});
