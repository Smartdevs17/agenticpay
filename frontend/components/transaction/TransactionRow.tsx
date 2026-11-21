'use client';

import { forwardRef, useLayoutEffect, useRef } from 'react';
import { CheckCircle2, Clock, ExternalLink, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import type { Payment } from '@/lib/types';

export interface TransactionRowProps {
  payment: Payment;
  timezone?: string;
  formatDateTime: (timestamp: string, timezone?: string) => string;
  onHeightChange?: (id: string, height: number) => void;
  isSelected?: boolean;
  isFocused?: boolean;
}

function StatusIcon({ status }: { status: Payment['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />;
    case 'pending':
      return <Clock className="h-5 w-5 text-yellow-600" aria-hidden />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-600" aria-hidden />;
    default:
      return null;
  }
}

export const TransactionRow = forwardRef<HTMLDivElement, TransactionRowProps>(
  function TransactionRow(
    { payment, timezone, formatDateTime, onHeightChange, isSelected, isFocused },
    ref
  ) {
    const innerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el || !onHeightChange) return;

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) onHeightChange(payment.id, entry.contentRect.height);
      });

      observer.observe(el);
      onHeightChange(payment.id, el.getBoundingClientRect().height);

      return () => observer.disconnect();
    }, [payment.id, onHeightChange, payment.transactionHash, payment.projectTitle]);

    return (
      <div ref={ref} className="px-1 pb-2">
        <Card
          ref={innerRef}
          className={[
            'hover:shadow-lg transition-all h-full',
            isSelected ? 'ring-2 ring-primary' : '',
            isFocused ? 'ring-2 ring-ring' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <StatusIcon status={payment.status} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {payment.projectTitle}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {payment.type === 'milestone_payment' ? 'Milestone Payment' : 'Full Payment'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDateTime(payment.timestamp, timezone)}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0 ml-4">
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {payment.amount} {payment.currency}
                </p>

                {payment.transactionHash && (
                  <a
                    href={`https://testnet.cronoscan.com/tx/${payment.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2 justify-end"
                  >
                    View on Explorer
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
            </div>

            {payment.transactionHash && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <p className="text-[10px] text-gray-400 font-mono truncate flex-1">{payment.transactionHash}</p>
                <CopyButton value={payment.transactionHash} label="Transaction hash copied" size="sm" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
);
