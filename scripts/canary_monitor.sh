#!/bin/bash
# Returns 0 if healthy, 1 if failure detected

BACKEND_URL="https://api.agenticpay.com/api/v1/health" # Mock URL
ERROR_THRESHOLD=5

echo "Monitoring Canary health for 60 seconds..."
# Simulate checking Prometheus/Logs
# In a real scenario, you'd curl your metrics endpoint
ERRORS=$(curl -s $BACKEND_URL | jq '.errors_last_minute' || echo 0)

if [ "$ERRORS" -gt "$ERROR_THRESHOLD" ]; then
  echo "FAILURE: $ERRORS errors detected! Threshold is $ERROR_THRESHOLD."
  exit 1
else
  echo "Canary is healthy."
  exit 0
fi