'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface ShowToastOptions {
  type?: NotificationType;
  duration?: number;
}

export function useNotificationToast() {
  const t = useTranslations('notifications');

  const showToast = (message: string, options: ShowToastOptions = {}) => {
    const { type = 'info', duration = 3000 } = options;

    switch (type) {
      case 'success':
        toast.success(message, { duration });
        break;
      case 'error':
        toast.error(message, { duration });
        break;
      case 'warning':
        toast.warning ? toast.warning(message, { duration }) : toast.message(message, { duration });
        break;
      default:
        toast.message(message, { duration });
    }
  };

  return { showToast, t };
}
