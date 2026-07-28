'use client';

import { useState, useCallback } from 'react';
import { PaymentRequestExpirationBadge, type RequestStatus } from './PaymentRequestExpirationBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentRequestItem {
  id:               string;
  amount:           string;
  currency:         string;
  status:           RequestStatus;
  expiresAt:        string;
  expiredAt?:       string | null;
  paidAt?:          string | null;
  requesterAddress: string;
  payerAddress?:    string | null;
  memo?:            string | null;
  createdAt:        string;
}

type FilterStatus = 'all' | RequestStatus;

interface PaymentRequestListProps {
  requests:    PaymentRequestItem[];
  onRenew?:    (id: string) => void;
  onCancel?:   (id: string) => void;
  isLoading?:  boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dashboard table for payment requests.
 *
 * Features:
 *  - Filter by status (all / pending / paid / expired / cancelled)
 *  - Live expiration countdown per row via PaymentRequestExpirationBadge
 *  - Renew action for expired/cancelled requests
 *  - Cancel action for pending requests
 */
export function PaymentRequestList({
  requests,
  onRenew,
  onCancel,
  isLoading = false,
}: PaymentRequestListProps) {
  const [filter, setFilter] = useState<FilterStatus>('all');

  const filtered = useCallback(
    () =>
      filter === 'all'
        ? requests
        : requests.filter((r) => r.status === filter),
    [requests, filter],
  )();

  const filterButtons: { label: string; value: FilterStatus }[] = [
    { label: 'All',       value: 'all' },
    { label: 'Pending',   value: 'pending' },
    { label: 'Paid',      value: 'paid' },
    { label: 'Expired',   value: 'expired' },
    { label: 'Cancelled', value: 'cancelled' },
  ];

  return (
    <div className="w-full space-y-4">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter payment requests by status">
        {filterButtons.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              filter === value
                ? 'bg-indigo-600 text-white focus-visible:ring-indigo-500'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 focus-visible:ring-gray-400'
            }`}
          >
            {label}
            {value !== 'all' && (
              <span className="ml-1.5 text-xs opacity-70">
                ({requests.filter((r) => r.status === value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No payment requests found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['ID', 'Amount', 'Status / Expiry', 'From / To', 'Created', 'Actions'].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
              {filtered.map((req) => (
                <tr key={req.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  {/* ID */}
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {req.id.slice(0, 8)}…
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {req.amount} {req.currency}
                  </td>

                  {/* Status / Expiry */}
                  <td className="px-4 py-3">
                    <PaymentRequestExpirationBadge
                      status={req.status}
                      expiresAt={req.expiresAt}
                      expiredAt={req.expiredAt}
                    />
                  </td>

                  {/* Addresses */}
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    <div title={req.requesterAddress}>
                      From: {req.requesterAddress.slice(0, 8)}…
                    </div>
                    {req.payerAddress && (
                      <div title={req.payerAddress}>
                        To: {req.payerAddress.slice(0, 8)}…
                      </div>
                    )}
                  </td>

                  {/* Created */}
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {(req.status === 'expired' || req.status === 'cancelled') && onRenew && (
                        <button
                          onClick={() => onRenew(req.id)}
                          className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          Renew
                        </button>
                      )}
                      {req.status === 'pending' && onCancel && (
                        <button
                          onClick={() => onCancel(req.id)}
                          className="rounded bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
