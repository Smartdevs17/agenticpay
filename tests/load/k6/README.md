# k6 load tests

The k6 suite provides a fast health smoke test and a staged payment-read load
test with enforced latency, error-rate, and check thresholds.

```bash
BASE_URL=https://staging.example.com npm run load:k6:smoke
BASE_URL=https://staging.example.com npm run load:k6
```

Tune traffic with `START_RATE`, `TARGET_RATE`, `PREALLOCATED_VUS`, `MAX_VUS`,
`RAMP_DURATION`, and `HOLD_DURATION`. A threshold breach exits non-zero. Run
against staging or an isolated environment; never point the suite at production
without incident-owner approval.
