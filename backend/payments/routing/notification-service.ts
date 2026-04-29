import { RoutingDecision, PaymentRoute, NetworkId } from './types';

type NotificationChannel = 'websocket' | 'email' | 'push';

interface NotificationPayload {
  type: 'routing_decision' | 'fallback_triggered' | 'bridge_initiated';
  paymentId: string;
  message: string;
  details: Record<string, unknown>;
  timestamp: number;
}

const SUBSCRIBERS = new Map<string, Set<(payload: NotificationPayload) => void>>();

export function subscribeToRoutingNotifications(
  userId: string,
  callback: (payload: NotificationPayload) => void
): () => void {
  if (!SUBSCRIBERS.has(userId)) {
    SUBSCRIBERS.set(userId, new Set());
  }
  SUBSCRIBERS.get(userId)!.add(callback);

  return () => {
    SUBSCRIBERS.get(userId)?.delete(callback);
  };
}

export function notifyRoutingDecision(
  userId: string,
  decision: RoutingDecision
): void {
  const route = decision.selectedRoute;
  const payload: NotificationPayload = {
    type: 'routing_decision',
    paymentId: decision.paymentId,
    message: buildRoutingMessage(route),
    details: {
      primary: route.primary,
      fallbacks: route.fallbacks,
      estimatedFee: route.scores[route.primary]?.estimatedFeeUsd,
      estimatedTime: route.scores[route.primary]?.estimatedTimeSeconds,
      bridgeRequired: route.bridgeRequired,
    },
    timestamp: decision.timestamp,
  };

  dispatchNotification(userId, payload);
}

export function notifyFallback(
  userId: string,
  paymentId: string,
  fromNetwork: NetworkId,
  toNetwork: NetworkId,
  error: string
): void {
  const payload: NotificationPayload = {
    type: 'fallback_triggered',
    paymentId,
    message: `Payment failed on ${fromNetwork}. Retrying on ${toNetwork}...`,
    details: { fromNetwork, toNetwork, error },
    timestamp: Date.now(),
  };

  dispatchNotification(userId, payload);
}

export function notifyBridge(
  userId: string,
  paymentId: string,
  sourceNetwork: NetworkId,
  targetNetwork: NetworkId
): void {
  const payload: NotificationPayload = {
    type: 'bridge_initiated',
    paymentId,
    message: `Cross-chain bridge initiated from ${sourceNetwork} to ${targetNetwork}`,
    details: { sourceNetwork, targetNetwork },
    timestamp: Date.now(),
  };

  dispatchNotification(userId, payload);
}

function buildRoutingMessage(route: PaymentRoute): string {
  const primary = route.scores[route.primary];
  if (!primary) return 'Route calculated';

  const parts = [
    `Optimal network: ${route.primary}`,
    `Est. fee: $${primary.estimatedFeeUsd.toFixed(4)}`,
    `Est. time: ~${Math.ceil(primary.estimatedTimeSeconds)}s`,
  ];

  if (route.bridgeRequired) {
    parts.push('Cross-chain bridge required');
  }

  if (route.fallbacks.length > 0) {
    parts.push(`Fallbacks: ${route.fallbacks.join(', ')}`);
  }

  return parts.join(' | ');
}

function dispatchNotification(userId: string, payload: NotificationPayload): void {
  const callbacks = SUBSCRIBERS.get(userId);
  if (callbacks) {
    callbacks.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error('[notification] Callback error:', err);
      }
    });
  }

  // Also log for analytics
  console.log('[routing:notification]', payload);
}