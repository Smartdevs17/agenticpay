import type { WebSocketOutboundMessage } from './types.js';

export type WebSocketScalingAdapter = {
  publish(message: WebSocketOutboundMessage): Promise<void> | void;
  subscribe(handler: (message: WebSocketOutboundMessage) => void): Promise<() => void> | (() => void);
};

type RedisLikePublisher = {
  publish(channel: string, message: string): Promise<unknown> | unknown;
};

type RedisLikeSubscriber = {
  subscribe(channel: string, handler: (message: string) => void): Promise<unknown> | unknown;
  unsubscribe(channel: string): Promise<unknown> | unknown;
};

export class RedisWebSocketScalingAdapter implements WebSocketScalingAdapter {
  constructor(
    private readonly publisher: RedisLikePublisher,
    private readonly subscriber: RedisLikeSubscriber,
    private readonly channel = 'agenticpay:websocket:broadcast'
  ) {}

  publish(message: WebSocketOutboundMessage): Promise<unknown> | unknown {
    return this.publisher.publish(this.channel, JSON.stringify(message));
  }

  async subscribe(handler: (message: WebSocketOutboundMessage) => void): Promise<() => void> {
    await this.subscriber.subscribe(this.channel, (raw) => {
      try {
        handler(JSON.parse(raw) as WebSocketOutboundMessage);
      } catch {
        // Ignore malformed cross-node messages.
      }
    });

    return () => {
      void this.subscriber.unsubscribe(this.channel);
    };
  }
}
