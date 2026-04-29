import type { DomainEventType, EventHandler, StoredEvent } from './event-types.js';

type WildcardHandler = (event: StoredEvent) => void | Promise<void>;

const handlers = new Map<string, Set<EventHandler>>();
let wildcardHandlers: Set<WildcardHandler> = new Set();

export function subscribe<T = unknown>(type: DomainEventType, handler: EventHandler<T>): () => void {
  const set = handlers.get(type) ?? new Set<EventHandler>();
  set.add(handler as EventHandler);
  handlers.set(type, set);

  return () => {
    set.delete(handler as EventHandler);
  };
}

export function subscribeAll(handler: WildcardHandler): () => void {
  wildcardHandlers.add(handler);
  return () => wildcardHandlers.delete(handler);
}

export async function publish(event: StoredEvent): Promise<void> {
  const typed = handlers.get(event.type);
  if (typed) {
    await Promise.all(Array.from(typed).map((h) => h(event)));
  }

  if (wildcardHandlers.size > 0) {
    await Promise.all(Array.from(wildcardHandlers).map((h) => h(event)));
  }
}

export function clearHandlers(): void {
  handlers.clear();
  wildcardHandlers = new Set();
}
