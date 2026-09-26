import { Router, Request, Response } from 'express';

interface CostMetric {
  date: string;
  compute: number;
  storage: number;
  network: number;
  database: number;
  total: number;
}

interface CostOptimizationRecommendation {
  category: string;
  description: string;
  estimatedSavings: number;
  priority: 'high' | 'medium' | 'low';
}

interface CostDashboardData {
  currentMonth: CostMetric;
  previousMonth: CostMetric;
  trend: number;
  recommendations: CostOptimizationRecommendation[];
  projectedAnnualCost: number;
}

const router = Router();

function generateMockCostMetrics(
  month: number = new Date().getMonth(),
): CostMetric {
  const baseComputeCost = 5000;
  const baseStorageCost = 1500;
  const baseNetworkCost = 800;
  const baseDatabaseCost = 2000;

  return {
    date: new Date(new Date().getFullYear(), month, 1).toISOString(),
    compute: baseComputeCost + Math.random() * 500,
    storage: baseStorageCost + Math.random() * 200,
    network: baseNetworkCost + Math.random() * 100,
    database: baseDatabaseCost + Math.random() * 300,
    total: 0,
  };
}

function calculateTotalCost(metric: CostMetric): CostMetric {
  return {
    ...metric,
    total: metric.compute + metric.storage + metric.network + metric.database,
  };
}

function generateRecommendations(): CostOptimizationRecommendation[] {
  return [
    {
      category: 'Compute',
      description: 'Consider using reserved instances for stable workloads',
      estimatedSavings: 1200,
      priority: 'high',
    },
    {
      category: 'Storage',
      description: 'Archive unused data to cold storage',
      estimatedSavings: 300,
      priority: 'medium',
    },
    {
      category: 'Database',
      description: 'Optimize index usage and query patterns',
      estimatedSavings: 400,
      priority: 'high',
    },
    {
      category: 'Network',
      description: 'Enable CDN for static content distribution',
      estimatedSavings: 200,
      priority: 'medium',
    },
  ];
}

router.get('/dashboard', (_req: Request, res: Response) => {
  const currentDate = new Date();
  const currentMonth = generateMockCostMetrics(currentDate.getMonth());
  const previousMonth = generateMockCostMetrics(currentDate.getMonth() - 1);

  const currentCost = calculateTotalCost(currentMonth);
  const previousCost = calculateTotalCost(previousMonth);

  const trend =
    ((currentCost.total - previousCost.total) / previousCost.total) * 100;

  const data: CostDashboardData = {
    currentMonth: currentCost,
    previousMonth: previousCost,
    trend,
    recommendations: generateRecommendations(),
    projectedAnnualCost: currentCost.total * 12,
  };

  res.json(data);
});

router.get('/summary', (_req: Request, res: Response) => {
  const current = calculateTotalCost(generateMockCostMetrics());
  const recommendations = generateRecommendations();

  const totalPotentialSavings = recommendations.reduce(
    (sum, rec) => sum + rec.estimatedSavings,
    0,
  );

  res.json({
    currentMonthCost: current.total,
    estimatedMonthlyWithOptimizations:
      current.total - totalPotentialSavings * 0.7,
    highPriorityRecommendations: recommendations.filter(
      (r) => r.priority === 'high',
    ),
    potentialMonthlySavings: totalPotentialSavings * 0.7,
    potentialAnnualSavings: totalPotentialSavings * 0.7 * 12,
  });
});

export default router;
