import * as fs from 'fs';
import * as path from 'path';

interface PerformanceMetric {
  timestamp: number;
  metric: string;
  value: number;
  baseline: number;
  threshold: number;
}

interface RegressionResult {
  detected: boolean;
  regressions: PerformanceMetric[];
  summary: string;
}

const REGRESSION_THRESHOLD = 0.1;
const METRICS_HISTORY_FILE = path.join(__dirname, 'metrics-history.json');

function loadMetricsHistory(): Record<string, number[]> {
  try {
    if (fs.existsSync(METRICS_HISTORY_FILE)) {
      const data = fs.readFileSync(METRICS_HISTORY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Failed to load metrics history:', error);
  }
  return {};
}

function saveMetricsHistory(history: Record<string, number[]>): void {
  try {
    const dir = path.dirname(METRICS_HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(METRICS_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Failed to save metrics history:', error);
  }
}

function calculateBaseline(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function detectRegressions(
  currentMetrics: Record<string, number>,
): RegressionResult {
  const history = loadMetricsHistory();
  const regressions: PerformanceMetric[] = [];
  const updatedHistory = { ...history };

  for (const [metric, value] of Object.entries(currentMetrics)) {
    if (!updatedHistory[metric]) {
      updatedHistory[metric] = [];
    }

    const baseline = calculateBaseline(updatedHistory[metric]);
    const threshold = baseline * (1 + REGRESSION_THRESHOLD);

    if (baseline > 0 && value > threshold) {
      regressions.push({
        timestamp: Date.now(),
        metric,
        value,
        baseline,
        threshold,
      });
    }

    updatedHistory[metric].push(value);
    if (updatedHistory[metric].length > 100) {
      updatedHistory[metric].shift();
    }
  }

  saveMetricsHistory(updatedHistory);

  const summary =
    regressions.length === 0
      ? 'No regressions detected'
      : `${regressions.length} performance regression(s) detected`;

  return {
    detected: regressions.length > 0,
    regressions,
    summary,
  };
}

function formatRegressionReport(result: RegressionResult): string {
  let report = `Performance Regression Detection Report\n`;
  report += `Generated: ${new Date().toISOString()}\n\n`;
  report += `Summary: ${result.summary}\n\n`;

  if (result.regressions.length > 0) {
    report += `Regressions:\n`;
    result.regressions.forEach((reg) => {
      const degradation = (
        ((reg.value - reg.baseline) / reg.baseline) *
        100
      ).toFixed(2);
      report += `- ${reg.metric}: ${reg.value.toFixed(2)} (baseline: ${reg.baseline.toFixed(2)}, degradation: +${degradation}%)\n`;
    });
  }

  return report;
}

export { detectRegressions, formatRegressionReport, PerformanceMetric, RegressionResult };
