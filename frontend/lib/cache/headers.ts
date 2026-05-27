import { CACHE_HEADERS } from "@/lib/cache/config";
import { recordCacheObservation } from "@/lib/cache/analytics";

export interface CacheEnvelope<T> {
  cacheKey: string;
  tags: string[];
  generatedAt: string;
  revalidateAfterSeconds: number;
  data: T;
}

type CacheStatus = "miss" | "hit" | "stale";

function determineCacheStatus(generatedAt: Date, revalidateAfterSeconds: number, servedAt: Date): CacheStatus {
  const ageSeconds = Math.max(0, Math.floor((servedAt.getTime() - generatedAt.getTime()) / 1000));

  if (ageSeconds <= 2) return "miss";
  if (ageSeconds >= revalidateAfterSeconds) return "stale";
  return "hit";
}

export function createCacheHeaders<T>(envelope: CacheEnvelope<T>) {
  const servedAt = new Date();
  const generatedAt = new Date(envelope.generatedAt);
  const ageSeconds = Math.max(0, Math.floor((servedAt.getTime() - generatedAt.getTime()) / 1000));
  const secondsUntilRevalidate = Math.max(0, envelope.revalidateAfterSeconds - ageSeconds);
  const status = determineCacheStatus(generatedAt, envelope.revalidateAfterSeconds, servedAt);

  recordCacheObservation({
    key: envelope.cacheKey,
    status,
    generatedAt: envelope.generatedAt,
    servedAt: servedAt.toISOString(),
  });

  return {
    [CACHE_HEADERS.status]: status,
    [CACHE_HEADERS.key]: envelope.cacheKey,
    [CACHE_HEADERS.generatedAt]: envelope.generatedAt,
    [CACHE_HEADERS.age]: String(ageSeconds),
    [CACHE_HEADERS.revalidateIn]: String(secondsUntilRevalidate),
    [CACHE_HEADERS.tags]: envelope.tags.join(","),
  };
}

export function observeCacheEnvelope<T>(envelope: CacheEnvelope<T>) {
  const servedAt = new Date();
  const generatedAt = new Date(envelope.generatedAt);
  const status = determineCacheStatus(generatedAt, envelope.revalidateAfterSeconds, servedAt);

  recordCacheObservation({
    key: envelope.cacheKey,
    status,
    generatedAt: envelope.generatedAt,
    servedAt: servedAt.toISOString(),
  });
}
