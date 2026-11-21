# ML Revenue Forecasting — Issue #854

## Overview
Ensemble ML forecasting with cross-validated model selection.

## Service
`backend/src/services/ml-forecast.ts` — `MLForecastService`

### Models
- Linear regression
- Polynomial degree 2
- Exponential smoothing (alpha 0.3)
- Holt-Winters seasonal (period 7)
- Moving average (window 7)
- Ensemble blend 85% best + 15% MA

### Inference
1. Split historical 80/20 holdout
2. Train each model on train, predict holdout, compute MAE/RMSE/MAPE/R2/Bias
3. Select best by RMSE
4. Retrain best on full data, forecast horizon with confidence interval (1.96*RMSE)
5. Detect seasonality via autocorrelation, determine trend slope

### API
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/forecast/ml/predict | `{ historical: [{timestamp,value}], horizon }` or auto from analytics |
| GET | /api/v1/forecast/ml/predict?horizon=&since=&granularity= | Forecast from analytics time series |
| POST | /api/v1/forecast/ml/evaluate | Evaluate models |
| POST | /api/v1/forecast/ml/features | Feature engineering |

### Example
```json
{
  "historical": [{ "timestamp": "2026-01-01", "value": 1200 }],
  "forecast": [{ "timestamp": "2026-02-01", "predicted": 1350, "lowerBound": 1100, "upperBound": 1600, "model": "holt_winters" }],
  "bestModel": "holt_winters",
  "confidence": "high",
  "trend": "up",
  "seasonalityDetected": true,
  "seasonalityPeriod": 7,
  "summary": { "next7Days": 9450, "next30Days": 40500, "next90Days": 121500 }
}
```
