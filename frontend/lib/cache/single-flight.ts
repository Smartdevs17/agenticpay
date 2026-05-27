const inflight = new Map<string, Promise<unknown>>();

export async function withSingleFlight<T>(key: string, execute: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = execute().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

