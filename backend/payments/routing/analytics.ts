import { RoutingDecision, NetworkId, RouteScore } from './types';

interface RoutingEvent {
  id: string;
  timestamp: number;
  paymentId: string;
  eventType: 'route_calculated' | 'tx_submitted' | 'tx_confirmed' | 'fallback_used' | 'bridge_completed' | 'failed';
  networkId: NetworkId;
  details: Record<string, unknown>;
}

interface RoutingReport {
  period: { start: number; end: number };
  totalPayments: number;
  successRate: number;
  averageFees: Record<NetworkId, number>;
  networkDistribution: Record<NetworkId, number>;
  fallbackRate: number;
  bridgeUsageRate: number;
  averageRoutingTimeMs: number;
}

const EVENT_STORE: RoutingEvent[] = [];
const MAX_EVENTS = 100000;

export function recordRoutingEvent(event: RoutingEvent): void {
  EVENT_STORE.push(event);
  if (EVENT_STORE.length > MAX_EVENTS) {
    EVENT_STORE.shift();
  }
}

export function generateRoutingReport(
  startTime: number,
  endTime: number
): RoutingReport {
  const events = EVENT_STORE.filter(
    (e) => e.timestamp >= startTime && e.timestamp <= endTime
  );

  const routeEvents = events.filter((e) => e.eventType === 'route_calculated');
  const submitEvents = events.filter((e) => e.eventType === 'tx_submitted');
  const confirmEvents = events.filter((e) => e.eventType === 'tx_confirmed');
  const fallbackEvents = events.filter((e) => e.eventType === 'fallback_used');
  const bridgeEvents = events.filter((e) => e.eventType === 'bridge_completed');
  const failedEvents = events.filter((e) => e.eventType === 'failed');

  // Calculate average fees by network
  const feeSums: Record<string, number> = {};
  const feeCounts: Record<string, number> = {};

  routeEvents.forEach((e) => {
    const fee = e.details.estimatedFeeUsd as number;
    if (fee !== undefined) {
      feeSums[e.networkId] = (feeSums[e.networkId] || 0) + fee;
      feeCounts[e.networkId] = (feeCounts[e.networkId] || 0) + 1;
    }
  });

  const averageFees: Record<NetworkId, number> = {} as Record<NetworkId, number>;
  Object.keys(feeSums).forEach((nid) => {
    averageFees[nid as NetworkId] = feeSums[nid] / feeCounts[nid];
  });

  // Network distribution
  const networkDistribution: Record<string, number> = {};
  confirmEvents.forEach((e) => {
    networkDistribution[e.networkId] = (networkDistribution[e.networkId] || 0) + 1;
  });

  const totalConfirmed = confirmEvents.length;
  const normalizedDistribution: Record<NetworkId, number> = {} as Record<NetworkId, number>;
  Object.keys(networkDistribution).forEach((nid) => {
    normalizedDistribution[nid as NetworkId] = networkDistribution[nid] / totalConfirmed;
  });

  return {
    period: { start: startTime, end: endTime },
    totalPayments: routeEvents.length,
    successRate: totalConfirmed / (totalConfirmed + failedEvents.length || 1),
    averageFees,
    networkDistribution: normalizedDistribution,
    fallbackRate: fallbackEvents.length / (submitEvents.length || 1),
    bridgeUsageRate: bridgeEvents.length / (routeEvents.length || 1),
    averageRoutingTimeMs: 0, // Would track actual routing time
  };
}

export function getRecentEvents(limit: number = 100): RoutingEvent[] {
  return EVENT_STORE.slice(-limit);
}

export function getEventsByPaymentId(paymentId: string): RoutingEvent[] {
  return EVENT_STORE.filter((e) => e.paymentId === paymentId);
}