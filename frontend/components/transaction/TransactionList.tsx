'use client';

import { useCallback, useMemo, useState } from 'react';
import { VirtualList, type VirtualListItem } from '@/src/components/virtual-list';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { useRowMeasurementCache } from '@/src/hooks/use-row-measurement-cache';
import type { Payment } from '@/lib/types';

interface PaymentListItem extends VirtualListItem, Payment {}

export interface TransactionListProps {
  payments: Payment[];
  timezone?: string;
  formatDateTime: (timestamp: string, timezone?: string) => string;
  /** Viewport height in px for the scroll container. */
  height?: number;
  className?: string;
}

const DEFAULT_ROW_HEIGHT = 160;
const OVERSCAN = 8;

export function TransactionList({
  payments,
  timezone,
  formatDateTime,
  height = 640,
  className = '',
}: TransactionListProps) {
  const { getHeight, setHeight } = useRowMeasurementCache(DEFAULT_ROW_HEIGHT);
  const [, bump] = useState(0);

  const items = useMemo<PaymentListItem[]>(
    () => payments.map((payment) => ({ ...payment, height: getHeight(payment.id) })),
    [payments, getHeight]
  );

  const handleHeightChange = useCallback(
    (id: string | number, measured: number) => {
      if (setHeight(id, measured)) bump((n) => n + 1);
    },
    [setHeight]
  );

  const getItemHeight = useCallback(
    (item: PaymentListItem) => getHeight(item.id),
    [getHeight]
  );

  return (
    <VirtualList
      items={items}
      containerHeight={height}
      estimatedRowHeight={DEFAULT_ROW_HEIGHT}
      overscan={OVERSCAN}
      getItemHeight={getItemHeight}
      onItemHeightChange={handleHeightChange}
      scrollKey="dashboard-payments"
      className={className}
      header={
        <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span>Transaction</span>
          <span className="text-center">Status</span>
          <span className="text-right">Amount</span>
        </div>
      }
      renderRow={(item, index, isSelected) => (
        <TransactionRow
          payment={item}
          timezone={timezone}
          formatDateTime={formatDateTime}
          onHeightChange={(id, h) => handleHeightChange(id, h)}
          isSelected={isSelected}
        />
      )}
    />
  );
}

export default TransactionList;
