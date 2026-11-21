import type { EventHandler, StoredEvent } from './event-types.js';

/**
 * Wraps an event handler so it processes each event id exactly once.
 * Duplicate deliveries (same event.id) are silently dropped.
 */
export function idempotentHandler<T = unknown>(
  handler: EventHandler<T>,
  processedStore: Set<string> = new Set()
): EventHandler<T> {
  async function wrappedHandler(event: StoredEvent<T>): Promise<void> {
    if (processedStore.has(event.id)) {
      return;
    }
    processedStore.add(event.id);
    await handler(event);
  }

  Object.defineProperty(wrappedHandler, 'name', {
    value: `idempotent(${handler.name || 'anonymous'})`,
  });

  return wrappedHandler;
}

/**
 * Creates a shared processed-ids store so a group of handlers can share
 * deduplication state (useful when multiple handlers process the same stream).
 */
export function createProcessedStore(): Set<string> {
  return new Set<string>();
}
