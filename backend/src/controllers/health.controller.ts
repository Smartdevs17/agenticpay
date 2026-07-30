import { Route, Get, Tags, OperationId } from 'tsoa';

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  timestamp: string;
  uptime: number;
  dependencies: {
    stellar: string;
    openai: string;
    scheduler: string;
  };
  latency_ms: number;
}

interface ReadyResponse {
  status: string;
  timestamp: string;
}

@Tags('Health')
@Route('health')
export class HealthController {
  /**
   * Get service health status
   * Returns dependency status for Stellar, OpenAI, and scheduler
   */
  @Get('/')
  @OperationId('getHealth')
  public async getHealth(): Promise<HealthCheckResponse> {
    const start = Date.now();
    
    const checks = {
      stellar: false,
      openai: false,
      scheduler: false,
    };

    // OpenAI Configuration Check
    checks.openai = !!process.env.OPENAI_API_KEY;

    // Scheduler Initialization Check
    checks.scheduler = !!process.env.JOB_SCHEDULER_ENABLED;

    // Stellar check (simplified for controller)
    checks.stellar = true; // Will be updated by actual service integration

    const dependencies = {
      stellar: checks.stellar ? 'healthy' : 'unhealthy',
      openai: checks.openai ? 'healthy' : 'unhealthy',
      scheduler: checks.scheduler ? 'healthy' : 'unhealthy',
    };

    const isUnhealthy = dependencies.stellar === 'unhealthy' || dependencies.scheduler === 'unhealthy';
    const isDegraded = dependencies.openai === 'unhealthy';

    let overallStatus = 'healthy';
    if (isUnhealthy) {
      overallStatus = 'unhealthy';
    } else if (isDegraded) {
      overallStatus = 'degraded';
    }

    const response: HealthCheckResponse = {
      status: overallStatus as 'healthy' | 'degraded' | 'unhealthy',
      service: 'agenticpay-backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies,
      latency_ms: Date.now() - start
    };

    return response;
  }

  /**
   * Kubernetes readiness probe
   * Application is ready if the router is mounted and responding
   */
  @Get('/ready')
  @OperationId('getReady')
  public async getReady(): Promise<ReadyResponse> {
    const response: ReadyResponse = {
      status: 'ready',
      timestamp: new Date().toISOString()
    };
    return response;
  }
}
