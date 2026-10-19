interface Runbook {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  triggerConditions: string[];
  steps: RunbookStep[];
  estimatedResolutionTime: number;
  postIncidentReview: boolean;
}

interface RunbookStep {
  order: number;
  title: string;
  action: string;
  timeout: number;
  onFailure: 'escalate' | 'retry' | 'continue';
  maxRetries: number;
}

interface IncidentContext {
  id: string;
  timestamp: number;
  severity: string;
  service: string;
  error?: string;
  metrics?: Record<string, number>;
}

class RunbookAutomation {
  private runbooks: Map<string, Runbook> = new Map();

  registerRunbook(runbook: Runbook): void {
    this.runbooks.set(runbook.id, runbook);
  }

  async executeRunbook(
    runbookId: string,
    context: IncidentContext,
  ): Promise<RunbookExecutionResult> {
    const runbook = this.runbooks.get(runbookId);
    if (!runbook) {
      throw new Error(`Runbook ${runbookId} not found`);
    }

    const executionId = `exec-${Date.now()}`;
    const results: StepExecutionResult[] = [];
    let currentStep = 0;

    try {
      for (const step of runbook.steps) {
        let retryCount = 0;
        let stepSucceeded = false;

        while (retryCount <= step.maxRetries && !stepSucceeded) {
          try {
            const result = await this.executeStep(step, context);
            results.push(result);
            stepSucceeded = true;
            currentStep++;
          } catch (error) {
            retryCount++;
            if (retryCount > step.maxRetries) {
              if (step.onFailure === 'escalate') {
                return {
                  executionId,
                  runbookId,
                  status: 'escalated',
                  currentStep,
                  results,
                  error: `Step ${step.order} failed: ${error}`,
                };
              } else if (step.onFailure === 'continue') {
                results.push({
                  stepOrder: step.order,
                  title: step.title,
                  status: 'skipped',
                  duration: 0,
                  error: String(error),
                });
                currentStep++;
                stepSucceeded = true;
              } else {
                throw error;
              }
            }
          }
        }
      }

      return {
        executionId,
        runbookId,
        status: 'completed',
        currentStep,
        results,
        duration: Date.now() - context.timestamp,
      };
    } catch (error) {
      return {
        executionId,
        runbookId,
        status: 'failed',
        currentStep,
        results,
        error: String(error),
      };
    }
  }

  private async executeStep(
    step: RunbookStep,
    context: IncidentContext,
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();

    try {
      const timeoutPromise = new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`Step timeout after ${step.timeout}ms`));
        }, step.timeout);
      });

      const actionPromise = this.performAction(step.action, context);
      await Promise.race([actionPromise, timeoutPromise]);

      return {
        stepOrder: step.order,
        title: step.title,
        status: 'completed',
        duration: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(`Step failed: ${error}`);
    }
  }

  private async performAction(
    action: string,
    context: IncidentContext,
  ): Promise<void> {
    const actionMap: Record<string, (ctx: IncidentContext) => Promise<void>> = {
      'restart-service': async (ctx) => {
        console.log(`Restarting service for context: ${ctx.service}`);
      },
      'scale-up-instances': async (ctx) => {
        console.log(`Scaling up instances for service: ${ctx.service}`);
      },
      'clear-cache': async (_ctx) => {
        console.log('Clearing application cache');
      },
      'activate-circuit-breaker': async (ctx) => {
        console.log(`Activating circuit breaker for: ${ctx.service}`);
      },
      'failover-to-secondary': async (_ctx) => {
        console.log('Failing over to secondary infrastructure');
      },
      'trigger-database-failover': async (_ctx) => {
        console.log('Triggering database failover');
      },
    };

    const actionFn = actionMap[action];
    if (!actionFn) {
      throw new Error(`Unknown action: ${action}`);
    }

    await actionFn(context);
  }

  createDefaultRunbooks(): void {
    this.registerRunbook({
      id: 'api-degradation',
      name: 'API Performance Degradation',
      severity: 'high',
      triggerConditions: [
        'p99_latency > 5000',
        'error_rate > 5%',
        'api_availability < 95%',
      ],
      steps: [
        {
          order: 1,
          title: 'Check API health status',
          action: 'health-check',
          timeout: 10000,
          onFailure: 'continue',
          maxRetries: 1,
        },
        {
          order: 2,
          title: 'Scale up API instances',
          action: 'scale-up-instances',
          timeout: 30000,
          onFailure: 'escalate',
          maxRetries: 2,
        },
        {
          order: 3,
          title: 'Clear application cache',
          action: 'clear-cache',
          timeout: 15000,
          onFailure: 'continue',
          maxRetries: 1,
        },
      ],
      estimatedResolutionTime: 5,
      postIncidentReview: true,
    });

    this.registerRunbook({
      id: 'database-outage',
      name: 'Database Outage',
      severity: 'critical',
      triggerConditions: [
        'database_connection_failures > 0',
        'database_availability = 0',
      ],
      steps: [
        {
          order: 1,
          title: 'Activate circuit breaker',
          action: 'activate-circuit-breaker',
          timeout: 5000,
          onFailure: 'continue',
          maxRetries: 1,
        },
        {
          order: 2,
          title: 'Trigger database failover',
          action: 'trigger-database-failover',
          timeout: 60000,
          onFailure: 'escalate',
          maxRetries: 1,
        },
        {
          order: 3,
          title: 'Verify failover status',
          action: 'verify-failover',
          timeout: 20000,
          onFailure: 'escalate',
          maxRetries: 2,
        },
      ],
      estimatedResolutionTime: 10,
      postIncidentReview: true,
    });

    this.registerRunbook({
      id: 'infrastructure-failover',
      name: 'Infrastructure Failover',
      severity: 'critical',
      triggerConditions: ['primary_region_unavailable = true'],
      steps: [
        {
          order: 1,
          title: 'Failover to secondary infrastructure',
          action: 'failover-to-secondary',
          timeout: 120000,
          onFailure: 'escalate',
          maxRetries: 1,
        },
        {
          order: 2,
          title: 'Verify secondary region health',
          action: 'health-check',
          timeout: 30000,
          onFailure: 'escalate',
          maxRetries: 2,
        },
      ],
      estimatedResolutionTime: 15,
      postIncidentReview: true,
    });
  }
}

interface StepExecutionResult {
  stepOrder: number;
  title: string;
  status: 'completed' | 'skipped' | 'failed';
  duration: number;
  error?: string;
}

interface RunbookExecutionResult {
  executionId: string;
  runbookId: string;
  status: 'completed' | 'escalated' | 'failed';
  currentStep: number;
  results: StepExecutionResult[];
  duration?: number;
  error?: string;
}

export {
  RunbookAutomation,
  Runbook,
  RunbookStep,
  IncidentContext,
  RunbookExecutionResult,
};
