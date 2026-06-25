#!/bin/bash
# Bundle analysis script for frontend
# Generates source-map-explorer reports and checks budgets

set -euo pipefail

FRONTEND_DIR="frontend"
REPORT_DIR="bundle-reports"
BUDGET_JS=500
BUDGET_CSS=200

mkdir -p "$REPORT_DIR"

echo "=== Running bundle analysis ==="

# Check for source-map-explorer
if ! command -v npx &> /dev/null; then
  echo "Error: npx not found"
  exit 1
fi

# Analyze JS bundles
echo "Analyzing JavaScript bundles..."
JS_FILES=($(find "$FRONTEND_DIR/.next/static/chunks" -name "*.js" 2>/dev/null || true))

if [ ${#JS_FILES[@]} -eq 0 ]; then
  echo "No JS chunk files found. Build the project first with: npm run build --filter=agenticpay-frontend"
  exit 1
fi

npx source-map-explorer "${JS_FILES[@]}" \
  --html \
  --output "$REPORT_DIR/bundle-report.html" \
  --no-browser \
  --gzip || echo "source-map-explorer exited with $? (some chunks may lack sourcemaps)"

# Analyze CSS bundles
echo "Analyzing CSS bundles..."
CSS_FILES=($(find "$FRONTEND_DIR/.next/static/css" -name "*.css" 2>/dev/null || true))

if [ ${#CSS_FILES[@]} -gt 0 ]; then
  npx source-map-explorer "${CSS_FILES[@]}" \
    --html \
    --output "$REPORT_DIR/css-report.html" \
    --no-browser || echo "source-map-explorer CSS analysis exited with $?"
fi

# Check budgets
echo ""
echo "=== Bundle Size Budget Check ==="
JS_SIZE_KB=$(find "$FRONTEND_DIR/.next/static/chunks" -name "*.js" -exec stat -c%s {} + 2>/dev/null | awk '{sum+=$1} END {printf "%.0f", sum/1024}')
CSS_SIZE_KB=$(find "$FRONTEND_DIR/.next/static/css" -name "*.css" -exec stat -c%s {} + 2>/dev/null | awk '{sum+=$1} END {printf "%.0f", sum/1024}')

echo "JS bundle size: ${JS_SIZE_KB:-0}KB (budget: ${BUDGET_JS}KB)"
echo "CSS bundle size: ${CSS_SIZE_KB:-0}KB (budget: ${BUDGET_CSS}KB)"

FAILED=0
if [ "${JS_SIZE_KB:-0}" -gt "$BUDGET_JS" ]; then
  echo "::warning::JS bundle ${JS_SIZE_KB}KB exceeds ${BUDGET_JS}KB budget"
  FAILED=1
fi
if [ "${CSS_SIZE_KB:-0}" -gt "$BUDGET_CSS" ]; then
  echo "::warning::CSS bundle ${CSS_SIZE_KB}KB exceeds ${BUDGET_CSS}KB budget"
  FAILED=1
fi

echo ""
echo "Reports generated:"
echo "  - $REPORT_DIR/bundle-report.html"
echo "  - $REPORT_DIR/css-report.html"

if [ "$FAILED" -eq 1 ]; then
  echo "::error::Bundle size budget exceeded. See reports for details."
  exit 1
fi

echo "All budgets passed."
