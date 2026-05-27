import type { DomainEventType, EventHandler, StoredEvent } from './event-types.js';
import type { AgenticPayWebSocketServer } from '../websocket/server.js';

type WildcardHandler = (event: StoredEvent) => void | Promise<void>;

const handlers = new Map<string, Set<EventHandler>>();
let wildcardHandlers: Set<WildcardHandler> = new Set();
let websocketServer: AgenticPayWebSocketServer | undefined;

const channelByEventPrefix: Array<{ prefix: string; channel: string }> = [
  { prefix: 'payment.', channel: 'payment.events' },
  { prefix: 'dispute.', channel: 'dispute.updates' },
  { prefix: 'project.disputed', channel: 'dispute.updates' },
];

export function bindWebSocketServer(server: AgenticPayWebSocketServer): void {
  websocketServer = server;
}

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

  const channel = channelByEventPrefix.find(({ prefix }) => event.type.startsWith(prefix))?.channel;
  if (channel) {
    websocketServer?.broadcastToChannel(channel, {
      type: event.type,
      payload: event,
      priority: channel === 'dispute.updates' ? 'high' : 'normal',
    });
  }
}

export function clearHandlers(): void {
  handlers.clear();
  wildcardHandlers = new Set();
  websocketServer = undefined;
}
