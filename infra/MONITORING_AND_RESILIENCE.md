# Monitoring and Resilience Features

This document describes the monitoring and resilience infrastructure implemented for AgenticPay.

## Overview

The infrastructure includes performance regression monitoring, cost optimization tracking, DNS failover strategy, and incident response runbook automation to ensure high availability and operational efficiency.

## Components

### 1. Performance Regression Monitoring

**Location:** `infra/monitoring/performance-regression-detector.ts`

Detects performance regressions by comparing current metrics against historical baselines.

**Features:**
- Tracks historical performance metrics
- Calculates baseline performance from historical data
- Detects regressions when current metrics exceed baseline by configured threshold
- Maintains sliding window of last 100 measurements per metric
- Generates detailed regression reports

**Usage:**
```typescript
import { detectRegressions, formatRegressionReport } from './performance-regression-detector';

const metrics = {
  'api.p99_latency': 2500,
  'api.response_time': 850,
  'database.query_time': 150,
};

const result = detectRegressions(metrics);
const report = formatRegressionReport(result);
console.log(report);
```

**Configuration:**
- `REGRESSION_THRESHOLD`: 10% (configurable) - triggers alert when metric exceeds baseline by this amount
- Metrics history persisted to `metrics-history.json`

### 2. Cost Optimization Dashboard

**Location:** `backend/src/api/routes/cost-optimization.route.ts`

Provides dashboard endpoints for tracking infrastructure costs and optimization recommendations.

**API Endpoints:**

#### GET `/api/cost-optimization/dashboard`
Returns comprehensive cost data with trends and recommendations.

**Response:**
```json
{
  "currentMonth": {
    "compute": 5000,
    "storage": 1500,
    "network": 800,
    "database": 2000,
    "total": 9300
  },
  "previousMonth": {
    "compute": 4800,
    "storage": 1400,
    "network": 750,
    "database": 1900,
    "total": 8850
  },
  "trend": 5.08,
  "recommendations": [
    {
      "category": "Compute",
      "description": "Consider using reserved instances for stable workloads",
      "estimatedSavings": 1200,
      "priority": "high"
    }
  ],
  "projectedAnnualCost": 111600
}
```

#### GET `/api/cost-optimization/summary`
Returns cost summary with potential savings from implementing recommendations.

**Response:**
```json
{
  "currentMonthCost": 9300,
  "estimatedMonthlyWithOptimizations": 7690,
  "highPriorityRecommendations": [...],
  "potentialMonthlySavings": 1610,
  "potentialAnnualSavings": 19320
}
```

### 3. DNS Failover Strategy

**Location:** `infra/dns/dns-failover.tf`

Implements AWS Route53-based DNS failover with health checks for automatic failover.

**Architecture:**
- Primary and secondary endpoints with health checks
- Automatic DNS failover on primary endpoint failure
- Separate failover records for API and app subdomains
- CloudWatch alarms for monitoring health check status

**Components:**

1. **Health Checks:**
   - HTTP health checks every 30 seconds
   - Failure threshold: 3 consecutive failures
   - Separate health checks for primary and secondary endpoints

2. **Route53 Records:**
   - Failover routing policy on primary and secondary records
   - Automatic failover when primary health check fails
   - Both API and app subdomains covered

3. **Monitoring:**
   - CloudWatch alarm triggers on primary endpoint failure
   - Configurable SNS topic for notifications

**Configuration Variables:**
- `domain_name`: Root domain
- `primary_endpoint`: Primary service endpoint
- `secondary_endpoint`: Secondary service endpoint for failover
- `primary_zone_id`: Route53 zone ID for primary region
- `secondary_zone_id`: Route53 zone ID for secondary region
- `alarm_actions`: SNS topics for alerts

**Deployment:**
```bash
terraform apply -var-file=dns/variables.tfvars infra/dns/
```

### 4. Incident Response Runbook Automation

**Location:** `infra/incident-response/runbook-automation.ts`

Automates incident response procedures through predefined runbooks.

**Features:**
- Register and execute runbooks based on incident type
- Built-in runbooks for common incidents (API degradation, database outage, infrastructure failover)
- Step-by-step execution with retry logic
- Timeout handling and failure modes (escalate, retry, continue)
- Post-incident review tracking

**Built-in Runbooks:**

1. **API Performance Degradation** (`api-degradation`)
   - Triggers on high latency, elevated error rate, or low availability
   - Steps:
     1. Check API health status
     2. Scale up API instances
     3. Clear application cache
   - Estimated resolution: 5 minutes

2. **Database Outage** (`database-outage`)
   - Triggers on database connection failures or complete unavailability
   - Steps:
     1. Activate circuit breaker
     2. Trigger database failover
     3. Verify failover status
   - Estimated resolution: 10 minutes

3. **Infrastructure Failover** (`infrastructure-failover`)
   - Triggers when primary region becomes unavailable
   - Steps:
     1. Failover to secondary infrastructure
     2. Verify secondary region health
   - Estimated resolution: 15 minutes

**Usage:**
```typescript
import { RunbookAutomation, IncidentContext } from './runbook-automation';

const automation = new RunbookAutomation();
automation.createDefaultRunbooks();

const context: IncidentContext = {
  id: 'inc-001',
  timestamp: Date.now(),
  severity: 'high',
  service: 'api',
  error: 'High latency detected',
  metrics: {
    p99_latency: 5500,
    error_rate: 0.08,
  },
};

const result = await automation.executeRunbook('api-degradation', context);
console.log(`Execution ${result.executionId} completed with status: ${result.status}`);
```

## Integration

### With Performance Monitoring Workflow

The performance regression detector integrates with the existing GitHub Actions workflow (`.github/workflows/performance-monitoring.yml`):

```bash
npm run test:performance  # Triggers regression detection
```

### With Monitoring Systems

Connect to Sentry, Datadog, or other APM platforms:
- Use performance regression detection results as additional data points
- Feed cost metrics into BI tools for cost analysis
- Link Route53 health checks with PagerDuty/Opsgenie

### With CI/CD Pipeline

Add to your deployment workflow:
```yaml
- name: Check performance regressions
  run: npx ts-node infra/monitoring/performance-regression-detector.ts

- name: Validate DNS failover
  run: terraform validate infra/dns/

- name: Test incident runbooks
  run: npm run test:incident-response
```

## Best Practices

1. **Performance Monitoring:**
   - Regularly review regression reports
   - Adjust thresholds based on service requirements
   - Maintain baseline data for accurate comparisons

2. **Cost Optimization:**
   - Review recommendations monthly
   - Implement high-priority suggestions first
   - Track savings from implemented recommendations

3. **DNS Failover:**
   - Test failover manually quarterly
   - Monitor failover events in CloudWatch
   - Ensure secondary region capacity matches primary

4. **Incident Response:**
   - Update runbooks as new incidents are discovered
   - Test runbook execution in staging environment
   - Conduct post-incident reviews to improve runbooks

## Alerting

Configure alerts for:
- Performance regressions detected
- Cost exceeding budget
- Primary endpoint health check failures
- Runbook execution escalations

## Metrics and KPIs

Track:
- Regression detection accuracy
- Cost reduction from recommendations
- Failover execution time
- Runbook success rate
- Mean time to recovery (MTTR)
