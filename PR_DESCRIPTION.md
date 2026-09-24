# PR: Implement funnel, ML forecasting, A/B testing, customer health (#852 #853 #854 #855)

**Branch:** `feat/issues-852-853-854-855`  
**Base:** `main`  
**Commits:**
- `bfc5bb0` feat: add funnel conversion tracking, ML forecasting, A/B testing, customer health (#852 #853 #854 #855)
- `05ac260` docs: add integration docs for funnel, ML forecast, AB testing, health

Closes #852
Closes #853
Closes #854
Closes #855

## Summary
This PR implements all four requested features:

### #853 Add funnel conversion tracking
- Service `backend/src/services/funnel-tracking.ts` with `FunnelTrackingService`
- Custom funnel definitions, step ordering, conversion window, per-step stats (entered, conversionRate, stepConversionRate, dropOff, avg/median/p95 time to next)
- User journey tracking with completion and conversion time
- Routes `backend/src/routes/funnel-tracking.ts` mounted at `/api/v1/funnels`
- Tests `backend/src/services/__tests__/funnel-tracking.test.ts` (9 cases)
- Docs `backend/docs/FUNNEL_TRACKING.md`

### #854 Implement revenue forecasting with ML
- Service `backend/src/services/ml-forecast.ts` with `MLForecastService`
- Ensemble: linear regression, polynomial (degree 2 via 3x3 solve), exponential smoothing, Holt-Winters seasonal, moving average
- Cross-validated model selection (80/20 holdout, RMSE), confidence intervals (1.96*RMSE), seasonality detection via autocorrelation, trend analysis
- Routes `backend/src/routes/ml-forecast.ts` mounted at `/api/v1/forecast/ml`
- Tests `backend/src/services/__tests__/ml-forecast.test.ts`
- Docs `backend/docs/ML_FORECAST.md`

### #852 Build A/B testing framework
- Service `backend/src/services/ab-testing.ts` with `ABTestingService`
- Deterministic MD5 bucket assignment, weighted variants, traffic allocation, lifecycle (draft/running/paused/completed/archived)
- Statistical: two-proportion z-test, Wilson interval, Bayesian prob, sample size calculator
- Routes `backend/src/routes/ab-testing.ts` mounted at `/api/v1/ab-tests`
- Tests `backend/src/services/__tests__/ab-testing.test.ts`
- Docs `backend/docs/AB_TESTING.md`

### #855 Build customer health score system
- Service `backend/src/services/customer-health.ts` with `CustomerHealthService`
- Composite 0-100 score: payment_health 30% + frequency 20% + recency 20% + engagement 15% + support 15%, with penalties for churn signals
- Levels champion/healthy/at_risk/critical, trend, riskReasons, recommendations, history, distribution, at-risk listing
- Routes `backend/src/routes/customer-health.ts` mounted at `/api/v1/customer-health`
- Tests `backend/src/services/__tests__/customer-health.test.ts`
- Docs `backend/docs/CUSTOMER_HEALTH.md`

## API Registration
Updated `backend/src/index.ts` to mount all new routers and fix missing `allowancesRouter` import.

## How to create PR (when GitHub auth available)
```bash
git push -u origin feat/issues-852-853-854-855
gh pr create --title "feat: add funnel conversion tracking, ML forecasting, A/B testing, customer health (#852 #853 #854 #855)" \
  --body "Closes #852, Closes #853, Closes #854, Closes #855" \
  --base main --head feat/issues-852-853-854-855
```
Or fork first:
```bash
gh repo fork Smartdevs17/agenticpay --clone=false
git remote add fork https://github.com/<your-user>/agenticpay.git
git push -u fork feat/issues-852-853-854-855
gh pr create --repo Smartdevs17/agenticpay --head <your-user>:feat/issues-852-853-854-855
```

## Testing
Tests are vitest-based, run with:
```bash
cd backend && npm test src/services/__tests__/funnel-tracking.test.ts src/services/__tests__/ml-forecast.test.ts src/services/__tests__/ab-testing.test.ts src/services/__tests__/customer-health.test.ts
```

All services expose `resetForTests()` for isolation.

## Verification
- `git log --oneline bfc5bb0..HEAD`
- `git diff main..HEAD --stat`
