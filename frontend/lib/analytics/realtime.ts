export interface AnalyticsRealtimeMessage<T = unknown> {
  type: string;
  channel?: string;
  payload?: T;
}

export function parseAnalyticsUpdates<T>(frame: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return [];
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const candidate = message as AnalyticsRealtimeMessage<T>;
    return candidate.type === "analytics:update" && candidate.payload
      ? [candidate.payload]
      : [];
  });
}

export function reconnectDelay(
  attempt: number,
  baseMs = 1_000,
  maxMs = 30_000,
): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}
