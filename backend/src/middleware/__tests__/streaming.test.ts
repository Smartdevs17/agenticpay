import { EventEmitter } from 'node:events';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  getStreamingMetrics,
  parseStreamingQuery,
  resetStreamingMetrics,
  streamDataset,
  takeStreamItems,
} from '../streaming';

function makeReq(): Request {
  return new EventEmitter() as Request;
}

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res = new EventEmitter() as Response & {
    chunks: string[];
    writableEnded: boolean;
    destroyed: boolean;
  };

  res.chunks = chunks;
  res.writableEnded = false;
  res.destroyed = false;
  res.status = vi.fn(() => res) as any;
  res.setHeader = vi.fn((name: string, value: string) => {
    headers[name] = value;
    return res;
  }) as any;
  res.write = vi.fn((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as any;
  res.end = vi.fn(() => {
    res.writableEnded = true;
    return res;
  }) as any;
  res.json = vi.fn((body: unknown) => {
    chunks.push(JSON.stringify(body));
    res.writableEnded = true;
    return res;
  }) as any;

  return { res, chunks, headers };
}

async function* rows() {
  yield { id: 1, name: 'one' };
  yield { id: 2, name: 'two' };
}

describe('streaming middleware helpers', () => {
  beforeEach(() => resetStreamingMetrics());

  it('parses streaming query defaults and caps batch size', () => {
    expect(parseStreamingQuery({})).toEqual({ format: 'json', limit: undefined, batchSize: 500 });
    expect(parseStreamingQuery({ format: 'jsonl', limit: '10', batchSize: '99999' })).toEqual({
      format: 'jsonl',
      limit: 10,
      batchSize: 5000,
    });
  });

  it('streams a JSON array without buffering every row first', async () => {
    const req = makeReq();
    const { res, chunks, headers } = makeRes();

    await streamDataset({ req, res, items: rows(), format: 'json' });

    expect(headers['Content-Type']).toBe('application/json');
    expect(chunks.join('')).toBe('{"data":[{"id":1,"name":"one"},{"id":2,"name":"two"}]}');
    expect(getStreamingMetrics()).toMatchObject({
      completedStreams: 1,
      rowsStreamed: 2,
      activeStreams: 0,
    });
  });

  it('streams newline-delimited JSON and applies transforms', async () => {
    const req = makeReq();
    const { res, chunks, headers } = makeRes();

    await streamDataset({
      req,
      res,
      items: rows(),
      format: 'jsonl',
      transform: (row) => ({ id: row.id }),
    });

    expect(headers['Content-Type']).toBe('application/x-ndjson');
    expect(chunks.join('')).toBe('{"id":1}\n{"id":2}\n');
  });

  it('limits async iterable output', async () => {
    const limited: Array<{ id: number; name: string }> = [];
    for await (const row of takeStreamItems(rows(), 1)) {
      limited.push(row);
    }

    expect(limited).toEqual([{ id: 1, name: 'one' }]);
  });
});
