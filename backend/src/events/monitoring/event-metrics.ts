import type { StoredEvent, DomainEventType } from '../event-types.js';

export interface EventMetrics {
  eventType: string;
  count: number;
  successCount: number;
  failureCount: number;
  avgProcessingTime: number;
  minProcessingTime: number;
  maxProcessingTime: number;
  lastProcessedAt: string;
}

export interface HandlerMetrics {
  handlerName: string;
  eventTypes: string[];
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  avgProcessingTime: number;
  minProcessingTime: number;
  maxProcessingTime: number;
  lastExecutedAt: string;
}

export interface SystemMetrics {
  totalEventsProcessed: number;
  totalHandlersExecuted: number;
  totalErrors: number;
  avgEventLatency: number;
  eventsPerSecond: number;
  uptime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
}

export interface PerformanceSnapshot {
  timestamp: string;
  eventMetrics: Record<string, EventMetrics>;
  handlerMetrics: Record<string, HandlerMetrics>;
  systemMetrics: SystemMetrics;
}

export class EventMetricsCollector {
  private eventMetrics: Map<string, EventMetrics> = new Map();
  private handlerMetrics: Map<string, HandlerMetrics> = new Map();
  private startTime: Date = new Date();
  private processingTimes: Map<string, number[]> = new Map();
  private maxSamples = 1000;

  recordEventProcessed(event: StoredEvent, processingTime: number, success: boolean): void {
    const eventType = event.type;

    // Update event metrics
    let metrics = this.eventMetrics.get(eventType);
    if (!metrics) {
      metrics = {
        eventType,
        count: 0,
        successCount: 0,
        failureCount: 0,
        avgProcessingTime: 0,
        minProcessingTime: Infinity,
        maxProcessingTime: 0,
        lastProcessedAt: new Date().toISOString(),
      };
      this.eventMetrics.set(eventType, metrics);
    }

    metrics.count++;
    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    // Update processing time statistics
    this.updateProcessingTimeStats(metrics, processingTime);
    metrics.lastProcessedAt = new Date().toISOString();

    // Store processing time for percentile calculations
    this.addProcessingTimeSample(eventType, processingTime);
  }

  recordHandlerExecuted(handlerName: string, event: StoredEvent, processingTime: number, success: boolean): void {
    const key = handlerName;

    let metrics = this.handlerMetrics.get(key);
    if (!metrics) {
      metrics = {
        handlerName,
        eventTypes: [],
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        avgProcessingTime: 0,
        minProcessingTime: Infinity,
        maxProcessingTime: 0,
        lastExecutedAt: new Date().toISOString(),
      };
      this.handlerMetrics.set(key, metrics);
    }

    metrics.totalProcessed++;
    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    // Track event types
    if (!metrics.eventTypes.includes(event.type)) {
      metrics.eventTypes.push(event.type);
    }

    // Update processing time statistics
    this.updateProcessingTimeStats(metrics, processingTime);
    metrics.lastExecutedAt = new Date().toISOString();
  }

  private updateProcessingTimeStats(metrics: EventMetrics | HandlerMetrics, processingTime: number): void {
    const currentAvg = metrics.avgProcessingTime;
    const currentCount = 'count' in metrics ? metrics.count : metrics.totalProcessed;

    // Update average
    metrics.avgProcessingTime = (currentAvg * currentCount + processingTime) / (currentCount + 1);

    // Update min/max
    metrics.minProcessingTime = Math.min(metrics.minProcessingTime, processingTime);
    metrics.maxProcessingTime = Math.max(metrics.maxProcessingTime, processingTime);
  }

  private addProcessingTimeSample(eventType: string, processingTime: number): void {
    let samples = this.processingTimes.get(eventType);
    if (!samples) {
      samples = [];
      this.processingTimes.set(eventType, samples);
    }

    samples.push(processingTime);

    // Keep only the most recent samples
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
  }

  getEventMetrics(eventType: string): EventMetrics | undefined {
    return this.eventMetrics.get(eventType);
  }

  getAllEventMetrics(): Record<string, EventMetrics> {
    return Object.fromEntries(this.eventMetrics);
  }

  getHandlerMetrics(handlerName: string): HandlerMetrics | undefined {
    return this.handlerMetrics.get(handlerName);
  }

  getAllHandlerMetrics(): Record<string, HandlerMetrics> {
    return Object.fromEntries(this.handlerMetrics);
  }

  getProcessingTimePercentile(eventType: string, percentile: number): number {
    const samples = this.processingTimes.get(eventType);
    if (!samples || samples.length === 0) {
      return 0;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  getSystemMetrics(): SystemMetrics {
    const totalEventsProcessed = Array.from(this.eventMetrics.values())
      .reduce((sum, m) => sum + m.count, 0);

    const totalHandlersExecuted = Array.from(this.handlerMetrics.values())
      .reduce((sum, m) => sum + m.totalProcessed, 0);

    const totalErrors = Array.from(this.eventMetrics.values())
      .reduce((sum, m) => sum + m.failureCount, 0);

    const avgEventLatency = this.calculateAverageLatency();

    const uptime = Date.now() - this.startTime.getTime();
    const eventsPerSecond = uptime > 0 ? (totalEventsProcessed / (uptime / 1000)) : 0;

    const memoryUsage = this.getMemoryUsage();

    return {
      totalEventsProcessed,
      totalHandlersExecuted,
      totalErrors,
      avgEventLatency,
      eventsPerSecond,
      uptime,
      memoryUsage,
    };
  }

  private calculateAverageLatency(): number {
    const allMetrics = Array.from(this.eventMetrics.values());
    if (allMetrics.length === 0) {
      return 0;
    }

    const totalAvg = allMetrics.reduce((sum, m) => sum + m.avgProcessingTime, 0);
    return totalAvg / allMetrics.length;
  }

  private getMemoryUsage(): { used: number; total: number; percentage: number } {
    const usage = process.memoryUsage();
    const total = usage.heapTotal;
    const used = usage.heapUsed;
    const percentage = (used / total) * 100;

    return {
      used,
      total,
      percentage,
    };
  }

  takeSnapshot(): PerformanceSnapshot {
    return {
      timestamp: new Date().toISOString(),
      eventMetrics: this.getAllEventMetrics(),
      handlerMetrics: this.getAllHandlerMetrics(),
      systemMetrics: this.getSystemMetrics(),
    };
  }

  reset(): void {
    this.eventMetrics.clear();
    this.handlerMetrics.clear();
    this.processingTimes.clear();
    this.startTime = new Date();
  }

  getTopSlowEvents(limit: number = 10): Array<{ eventType: string; avgProcessingTime: number }> {
    return Array.from(this.eventMetrics.entries())
      .map(([eventType, metrics]) => ({
        eventType,
        avgProcessingTime: metrics.avgProcessingTime,
      }))
      .sort((a, b) => b.avgProcessingTime - a.avgProcessingTime)
      .slice(0, limit);
  }

  getTopErrorEvents(limit: number = 10): Array<{ eventType: string; failureCount: number; failureRate: number }> {
    return Array.from(this.eventMetrics.entries())
      .map(([eventType, metrics]) => ({
        eventType,
        failureCount: metrics.failureCount,
        failureRate: metrics.count > 0 ? (metrics.failureCount / metrics.count) * 100 : 0,
      }))
      .sort((a, b) => b.failureCount - a.failureCount)
      .slice(0, limit);
  }

  getTopSlowHandlers(limit: number = 10): Array<{ handlerName: string; avgProcessingTime: number }> {
    return Array.from(this.handlerMetrics.entries())
      .map(([handlerName, metrics]) => ({
        handlerName,
        avgProcessingTime: metrics.avgProcessingTime,
      }))
      .sort((a, b) => b.avgProcessingTime - a.avgProcessingTime)
      .slice(0, limit);
  }
}

export class EventPerformanceMonitor {
  private collector: EventMetricsCollector;
  private enabled: boolean = true;

  constructor() {
    this.collector = new EventMetricsCollector();
  }

  wrapHandler<T = unknown>(
    handlerName: string,
    handler: (event: StoredEvent<T>) => void | Promise<void>
  ): (event: StoredEvent<T>) => Promise<void> {
    return async (event: StoredEvent<T>) => {
      if (!this.enabled) {
        return handler(event);
      }

      const startTime = Date.now();
      let success = false;

      try {
        await handler(event);
        success = true;
      } finally {
        const processingTime = Date.now() - startTime;
        this.collector.recordHandlerExecuted(handlerName, event, processingTime, success);
        this.collector.recordEventProcessed(event, processingTime, success);
      }
    };
  }

  getMetrics(): EventMetricsCollector {
    return this.collector;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const eventPerformanceMonitor = new EventPerformanceMonitor();
