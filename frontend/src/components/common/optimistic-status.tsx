'use client';

import { useEffect, useRef, useState } from 'react';
import { isOptimisticId } from '@/src/hooks/mutations/usePaymentMutations';

export type MutationState = 'idle' | 'pending' | 'success' | 'error';

interface OptimisticStatusProps {
  id?: string;
  state: MutationState;
  pendingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  successDurationMs?: number;
  className?: string;
}

export function OptimisticStatus({
  id,
  state,
  pendingLabel = 'Saving…',
  successLabel = 'Saved',
  errorLabel = 'Failed — tap to retry',
  successDurationMs = 2000,
  className = '',
}: OptimisticStatusProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state !== 'idle') {
      setVisible(true);
    }
    if (state === 'success') {
      timerRef.current = setTimeout(() => setVisible(false), successDurationMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state, successDurationMs]);

  if (!visible && state === 'idle') return null;

  const isOptimistic = id ? isOptimisticId(id) : false;

  const stateMap: Record<MutationState, { label: string; cls: string; icon: string }> = {
    idle: { label: '', cls: '', icon: '' },
    pending: {
      label: isOptimistic ? `${pendingLabel} (optimistic)` : pendingLabel,
      cls: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: '⟳',
    },
    success: {
      label: successLabel,
      cls: 'bg-green-50 text-green-700 border-green-200',
      icon: '✓',
    },
    error: {
      label: errorLabel,
      cls: 'bg-red-50 text-red-700 border-red-200',
      icon: '✕',
    },
  };

  const { label, cls, icon } = stateMap[state];
  if (!label) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={[
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium transition-opacity',
        cls,
        visible ? 'opacity-100' : 'opacity-0',
        className,
      ].join(' ')}
    >
      <span
        aria-hidden
        className={state === 'pending' ? 'inline-block animate-spin' : ''}
      >
        {icon}
      </span>
      {label}
    </span>
  );
}

// ─── Stale badge ─────────────────────────────────────────────────────────────

interface StaleBadgeProps {
  isStale: boolean;
  label?: string;
  className?: string;
}

export function StaleBadge({ isStale, label = 'Stale', className = '' }: StaleBadgeProps) {
  if (!isStale) return null;
  return (
    <span
      role="status"
      className={[
        'inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700',
        className,
      ].join(' ')}
    >
      {label}
    </span>
  );
}

// ─── Conflict banner ─────────────────────────────────────────────────────────

interface ConflictBannerProps {
  hasConflict: boolean;
  onAcceptServer: () => void;
  onKeepOptimistic: () => void;
}

export function ConflictBanner({ hasConflict, onAcceptServer, onKeepOptimistic }: ConflictBannerProps) {
  if (!hasConflict) return null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800"
    >
      <span className="font-medium">Data conflict detected.</span>
      <button
        onClick={onAcceptServer}
        className="underline hover:no-underline focus:outline-none"
      >
        Use server version
      </button>
      <span aria-hidden>·</span>
      <button
        onClick={onKeepOptimistic}
        className="underline hover:no-underline focus:outline-none"
      >
        Keep my changes
      </button>
    </div>
  );
}

// ─── useMutationState helper ─────────────────────────────────────────────────

interface UseMutationStateReturn {
  state: MutationState;
  reset: () => void;
}

export function useMutationState(
  isPending: boolean,
  isSuccess: boolean,
  isError: boolean,
): UseMutationStateReturn {
  const [state, setState] = useState<MutationState>('idle');

  useEffect(() => {
    if (isPending) setState('pending');
    else if (isSuccess) setState('success');
    else if (isError) setState('error');
    else setState('idle');
  }, [isPending, isSuccess, isError]);

  return { state, reset: () => setState('idle') };
}
