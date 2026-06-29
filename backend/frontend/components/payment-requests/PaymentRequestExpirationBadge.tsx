'use client';

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RequestStatus = 'pending' | 'paid' | 'expired' | 'cancelled';

interface PaymentRequestExpirationBadgeProps {
  status:    RequestStatus;
  expiresAt: string | Date;   // ISO string or Date
  expiredAt?: string | Date | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msRemaining(expiresAt: Date): number {
  return expiresAt.getTime() - Date.now();
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Expired';
  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h remaining`;
  if (h > 0) return `${h}h ${m}m remaining`;
  if (m > 0) return `${m}m ${s}s remaining`;
  return `${s}s remaining`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Displays the expiration state of a payment request.
 *
 * - pending  → live countdown ticker (turns red when < 5 min)
 * - expired  → "Expired" badge with timestamp
 * - paid     → "Paid" badge
 * - cancelled→ "Cancelled" badge
 */
export function PaymentRequestExpirationBadge({
  status,
  expiresAt,
  expiredAt,
}: PaymentRequestExpirationBadgeProps) {
  const deadline = new Date(expiresAt);
  const [remaining, setRemaining] = useState<number>(msRemaining(deadline));

  // Live countdown — only active for pending requests.
  useEffect(() => {
    if (status !== 'pending') return;
    const interval = setInterval(() => {
      setRemaining(msRemaining(deadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, deadline]);

  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
        ✓ Paid
      </span>
    );
  }

  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        Cancelled
      </span>
    );
  }

  if (status === 'expired' || remaining <= 0) {
    const expiredDisplay = expiredAt
      ? new Date(expiredAt).toLocaleString()
      : deadline.toLocaleString();
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400"
        title={`Expired at ${expiredDisplay}`}
      >
        ⏰ Expired
      </span>
    );
  }

  // Pending — show countdown, highlight urgency.
  const critical = remaining < 5 * 60 * 1000;   // < 5 min
  const warning  = remaining < 30 * 60 * 1000;  // < 30 min

  const colorClass = critical
    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    : warning
      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
      title={`Expires: ${deadline.toLocaleString()}`}
    >
      {critical ? '⚠️' : '⏳'} {formatCountdown(remaining)}
    </span>
  );
}
