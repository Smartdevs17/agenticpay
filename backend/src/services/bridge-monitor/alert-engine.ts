/**
 * alert-engine.ts — Issue #475
 *
 * Evaluates bridge message lifecycle and emits alerts for delays,
 * failures, and stuck messages.
 */

import type { BridgeAlertSeverity, BridgeMessageStatus, BridgeProvider } from '@prisma/client';

export interface BridgeMessageSnapshot {
  id: string;
  provider: BridgeProvider;
  sourceChain: string;
  destinationChain: string;
  messageId: string;
  status: BridgeMessageStatus;
  initiatedAt: Date;
  sourceConfirmedAt?: Date | null;
  relayedAt?: Date | null;
  executedAt?: Date | null;
  expectedDeliveryMs: number;
}

export interface BridgeAlertPayload {
  messageId: string;
  severity: BridgeAlertSeverity;
  alertType: string;
  message: string;
}

const DEFAULT_THRESHOLDS: Record<BridgeProvider, number> = {
  wormhole: 15 * 60 * 1000,
  layerzero: 10 * 60 * 1000,
  axelar: 20 * 60 * 1000,
  custom: 30 * 60 * 1000,
};

export function getExpectedDeliveryMs(provider: BridgeProvider): number {
  const envKey = `BRIDGE_THRESHOLD_${provider.toUpperCase()}_MS`;
  const override = process.env[envKey];
  if (override) return parseInt(override, 10);
  return DEFAULT_THRESHOLDS[provider];
}

export function evaluateMessage(msg: BridgeMessageSnapshot): BridgeAlertPayload[] {
  const alerts: BridgeAlertPayload[] = [];
  const now = Date.now();
  const age = now - msg.initiatedAt.getTime();
  const threshold = msg.expectedDeliveryMs || getExpectedDeliveryMs(msg.provider);

  if (msg.status === 'failed') {
    alerts.push({
      messageId: msg.id,
      severity: 'critical',
      alertType: 'delivery_failed',
      message: `Bridge message ${msg.messageId} (${msg.provider}) failed on ${msg.sourceChain} → ${msg.destinationChain}`,
    });
    return alerts;
  }

  if (msg.status === 'expired') {
    alerts.push({
      messageId: msg.id,
      severity: 'critical',
      alertType: 'message_expired',
      message: `Bridge message ${msg.messageId} expired before delivery`,
    });
    return alerts;
  }

  if (['initiated', 'source_confirmed', 'relayed'].includes(msg.status) && age > threshold) {
    alerts.push({
      messageId: msg.id,
      severity: age > threshold * 2 ? 'critical' : 'warning',
      alertType: 'delivery_delayed',
      message: `Bridge message ${msg.messageId} delayed: ${Math.round(age / 1000)}s elapsed (threshold: ${Math.round(threshold / 1000)}s)`,
    });
  }

  if (['initiated', 'source_confirmed', 'relayed'].includes(msg.status) && age > threshold * 3) {
    alerts.push({
      messageId: msg.id,
      severity: 'critical',
      alertType: 'message_stuck',
      message: `Bridge message ${msg.messageId} appears stuck in status "${msg.status}"`,
    });
  }

  if (msg.status === 'destination_executed' && msg.executedAt) {
    const latency = msg.executedAt.getTime() - msg.initiatedAt.getTime();
    if (latency > threshold) {
      alerts.push({
        messageId: msg.id,
        severity: 'info',
        alertType: 'slow_delivery',
        message: `Bridge message ${msg.messageId} delivered in ${Math.round(latency / 1000)}s (above ${Math.round(threshold / 1000)}s threshold)`,
      });
    }
  }

  return alerts;
}

export async function dispatchBridgeAlert(
  alert: BridgeAlertPayload,
  webhookUrl?: string,
): Promise<void> {
  const url = webhookUrl ?? process.env.BRIDGE_ALERT_WEBHOOK_URL ?? process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bridge_alert', ...alert, timestamp: new Date().toISOString() }),
    });
  } catch (err) {
    console.warn('[bridge-monitor] Alert dispatch failed:', err);
  }
}
