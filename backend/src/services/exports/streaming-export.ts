import { Readable, Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';

export type ExportFormat = 'csv' | 'jsonl';
export type ExportStatus = 'running' | 'completed' | 'cancelled' | 'error';

export interface ExportJob {
  id: string;
  format: ExportFormat;
  status: ExportStatus;
  rowsProcessed: number;
  totalEstimate?: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface StreamingExportConfig {
  chunkSize: number;
  maxRowLimit: number;
  maxConcurrentStreams: number;
  memoryLimitBytes: number;
}

const DEFAULT_CONFIG: StreamingExportConfig = {
  chunkSize: 500,
  maxRowLimit: 10_000_000,
  maxConcurrentStreams: 5,
  memoryLimitBytes: 50 * 1024 * 1024, // 50MB
};

export class StreamingExportService extends BaseService {
  private config: StreamingExportConfig;
  private activeJobs = new Map<string, ExportJob>();
  private abortControllers = new Map<string, AbortController>();

  constructor(config?: Partial<StreamingExportConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get activeStreamCount(): number {
    return Array.from(this.activeJobs.values()).filter((j) => j.status === 'running').length;
  }

  startExport(params: {
    format: ExportFormat;
    totalEstimate?: number;
  }): Result<ExportJob> {
    if (this.activeStreamCount >= this.config.maxConcurrentStreams) {
      return this.validationFailure(
        `Maximum concurrent streams (${this.config.maxConcurrentStreams}) reached. Try again later.`,
      );
    }

    const id = randomUUID();
    const job: ExportJob = {
      id,
      format: params.format,
      status: 'running',
      rowsProcessed: 0,
      totalEstimate: params.totalEstimate,
      startedAt: Date.now(),
    };

    const controller = new AbortController();
    this.activeJobs.set(id, job);
    this.abortControllers.set(id, controller);

    return this.ok(job);
  }

  getJob(exportId: string): Result<ExportJob> {
    const job = this.activeJobs.get(exportId);
    if (!job) {
      return this.notFoundFailure('ExportJob', exportId);
    }
    return this.ok(job);
  }

  cancelExport(exportId: string): Result<ExportJob> {
    const job = this.activeJobs.get(exportId);
    if (!job) {
      return this.notFoundFailure('ExportJob', exportId);
    }

    if (job.status !== 'running') {
      return this.validationFailure('Only running exports can be cancelled');
    }

    job.status = 'cancelled';
    job.completedAt = Date.now();
    this.activeJobs.set(exportId, job);

    const controller = this.abortControllers.get(exportId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(exportId);
    }

    return this.ok(job);
  }

  /// Create a streaming readable from an async data fetcher using cursor-based pagination.
  createCursorStream<T>(params: {
    exportId: string;
    fetchPage: (cursor: string | undefined, limit: number) => Promise<{ data: T[]; nextCursor?: string }>;
    format: ExportFormat;
    headers?: string[];
    rowSerializer: (item: T) => string;
    rowLimit?: number;
  }): Readable {
    const { exportId, fetchPage, format, headers, rowSerializer, rowLimit } = params;
    const chunkSize = this.config.chunkSize;
    const limit = rowLimit ?? this.config.maxRowLimit;
    const job = this.activeJobs.get(exportId);
    const controller = this.abortControllers.get(exportId);

    let cursor: string | undefined;
    let headerWritten = false;
    let totalRows = 0;

    const self = this;

    const stream = new Readable({
      async read() {
        if (controller?.signal.aborted) {
          this.push(null);
          return;
        }

        try {
          if (format === 'csv' && headers && !headerWritten) {
            this.push(headers.join(',') + '\n');
            headerWritten = true;
          }

          const page = await fetchPage(cursor, chunkSize);

          if (page.data.length === 0 || totalRows >= limit) {
            if (job) {
              job.status = 'completed';
              job.completedAt = Date.now();
              self.activeJobs.set(exportId, job);
              self.abortControllers.delete(exportId);
            }
            this.push(null);
            return;
          }

          const rowsToProcess = Math.min(page.data.length, limit - totalRows);
          const chunk = page.data.slice(0, rowsToProcess);

          let output = '';
          for (const item of chunk) {
            if (format === 'jsonl') {
              output += JSON.stringify(item) + '\n';
            } else {
              output += rowSerializer(item) + '\n';
            }
          }

          totalRows += chunk.length;
          if (job) {
            job.rowsProcessed = totalRows;
            self.activeJobs.set(exportId, job);
          }

          this.push(output);
          cursor = page.nextCursor;

          if (!page.nextCursor || totalRows >= limit) {
            if (job) {
              job.status = 'completed';
              job.completedAt = Date.now();
              self.activeJobs.set(exportId, job);
              self.abortControllers.delete(exportId);
            }
            this.push(null);
          }
        } catch (err) {
          if (job) {
            job.status = 'error';
            job.error = err instanceof Error ? err.message : 'Unknown error';
            job.completedAt = Date.now();
            self.activeJobs.set(exportId, job);
            self.abortControllers.delete(exportId);
          }
          this.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });

    return stream;
  }

  createBackpressureTransform(): Transform {
    return new Transform({
      highWaterMark: this.config.memoryLimitBytes,
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  }

  listJobs(): ExportJob[] {
    return Array.from(this.activeJobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  cleanupCompleted(): number {
    const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
    let cleaned = 0;
    for (const [id, job] of this.activeJobs) {
      if (job.status !== 'running' && job.completedAt && job.completedAt < cutoff) {
        this.activeJobs.delete(id);
        this.abortControllers.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

export const streamingExportService = new StreamingExportService();
