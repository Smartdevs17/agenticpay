import { once } from 'node:events';
import type { Request, Response } from 'express';

export type StreamFormat = 'json' | 'jsonl';

export interface StreamingQuery {
  format: StreamFormat;
  limit?: number;
  batchSize: number;
}

export interface StreamingMetrics {
  activeStreams: number;
  completedStreams: number;
  abortedStreams: number;
  failedStreams: number;
  rowsStreamed: number;
}

export interface StreamDatasetOptions<T> {
  req: Request;
  res: Response;
  items: AsyncIterable<T>;
  format?: StreamFormat;
  filename?: string;
  transform?: (item: T) => unknown;
}

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5000;
const MAX_LIMIT = 10_000_000;

const metrics: StreamingMetrics = {
  activeStreams: 0,
  completedStreams: 0,
  abortedStreams: 0,
  failedStreams: 0,
  rowsStreamed: 0,
};

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function parseStreamingQuery(query: Request['query']): StreamingQuery {
  const rawFormat = Array.isArray(query.format) ? query.format[0] : query.format;
  const format: StreamFormat = rawFormat === 'jsonl' ? 'jsonl' : 'json';
  const limitValue = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const limit = limitValue === undefined ? undefined : parsePositiveInt(limitValue, MAX_LIMIT, MAX_LIMIT);

  return {
    format,
    limit,
    batchSize: parsePositiveInt(query.batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
  };
}

async function writeChunk(res: Response, chunk: string): Promise<void> {
  if (res.write(chunk)) return;
  await once(res, 'drain');
}

export async function streamDataset<T>(options: StreamDatasetOptions<T>): Promise<void> {
  const { req, res, items, filename, transform = (item: T) => item } = options;
  const format = options.format ?? 'json';
  let first = true;
  let aborted = false;

  const onClose = () => {
    if (!res.writableEnded) aborted = true;
  };

  req.once('close', onClose);
  metrics.activeStreams += 1;

  try {
    res.status(200);
    res.setHeader('Content-Type', format === 'jsonl' ? 'application/x-ndjson' : 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    if (filename) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    if (format === 'json') {
      await writeChunk(res, '{"data":[');
    }

    for await (const item of items) {
      if (aborted || res.destroyed) break;

      const serialized = JSON.stringify(transform(item));
      if (format === 'jsonl') {
        await writeChunk(res, `${serialized}\n`);
      } else {
        await writeChunk(res, `${first ? '' : ','}${serialized}`);
        first = false;
      }
      metrics.rowsStreamed += 1;
    }

    if (format === 'json') {
      await writeChunk(res, ']}');
    }

    if (!res.writableEnded) res.end();

    if (aborted) metrics.abortedStreams += 1;
    else metrics.completedStreams += 1;
  } catch (error) {
    metrics.failedStreams += 1;
    if (!res.headersSent) {
      res.status(500).json({ error: 'STREAM_FAILED' });
    } else if (!res.writableEnded) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  } finally {
    req.removeListener('close', onClose);
    metrics.activeStreams = Math.max(0, metrics.activeStreams - 1);
  }
}

export async function* takeStreamItems<T>(items: AsyncIterable<T>, limit?: number): AsyncIterable<T> {
  let count = 0;
  for await (const item of items) {
    if (limit !== undefined && count >= limit) return;
    count += 1;
    yield item;
  }
}

export function getStreamingMetrics(): StreamingMetrics {
  return { ...metrics };
}

export function resetStreamingMetrics(): void {
  metrics.activeStreams = 0;
  metrics.completedStreams = 0;
  metrics.abortedStreams = 0;
  metrics.failedStreams = 0;
  metrics.rowsStreamed = 0;
}
