/**
 * Coalescing autosave primitive for portal editors.
 *
 * Rapid edits replace the pending payload and produce one server write after
 * the debounce interval. Flush serializes writes so a slow request cannot be
 * overtaken by a newer payload.
 */

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<void> | void;
  delayMs?: number;
}

export interface AutosaveController<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
  cancel(): void;
  hasPending(): boolean;
}

export function createAutosave<T>({ save, delayMs = 500 }: AutosaveOptions<T>): AutosaveController<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | undefined;
  let running: Promise<void> | undefined;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (running) await running;
    while (pending) {
      const value = pending.value;
      pending = undefined;
      running = Promise.resolve(save(value));
      try {
        await running;
      } finally {
        running = undefined;
      }
    }
  };

  return {
    schedule(value: T) {
      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void flush();
      }, Math.max(0, delayMs));
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
    hasPending: () => pending !== undefined,
  };
}
