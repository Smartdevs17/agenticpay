'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useAgenticPay } from './useAgenticPay';

export function useNotifications() {
  const { enabled, settings } = useNotificationStore();
  const { isConfirmed, isConfirming, hash, error } = useAgenticPay();
  const prevConfirmed = useRef(false);
  const prevConfirming = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    if (settings.transactionConfirmed) {
      if (isConfirming && !prevConfirming.current) {
        toast.loading('Transaction pending...', { id: 'tx-pending' });
      }
      if (isConfirmed && !prevConfirmed.current) {
        toast.dismiss('tx-pending');
        toast.success('Transaction confirmed!', {
          description: hash ? `Hash: ${hash.slice(0, 10)}...` : undefined,
        });
      }
    }

    if (error) {
      toast.error('Transaction failed', {
        description: error.message?.slice(0, 60),
      });
    }

    prevConfirmed.current = isConfirmed;
    prevConfirming.current = isConfirming;
  }, [isConfirming, isConfirmed, hash, error, enabled, settings]);
}

export function notifyProjectStatusChange(projectTitle: string, status: string) {
  const { enabled, settings } = useNotificationStore.getState();
  if (!enabled || !settings.projectStatusChange) return;

  const statusMessages: Record<string, string> = {
    funded: 'Project funded and ready to start',
    active: 'Project is now active',
    completed: 'Project completed successfully',
    cancelled: 'Project was cancelled',
    disputed: 'Project is under dispute',
  };

  toast.info(statusMessages[status] || `Project status changed to ${status}`, {
    description: projectTitle,
  });
}

export function notifyNewInvoice(projectTitle: string) {
  const { enabled, settings } = useNotificationStore.getState();
  if (!enabled || !settings.newInvoice) return;

  toast.success('New invoice generated', {
    description: `Invoice ready for: ${projectTitle}`,
  });
}