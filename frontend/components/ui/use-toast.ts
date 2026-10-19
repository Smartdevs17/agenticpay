'use client';

import { toast } from 'sonner';

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  duration?: number;
}

export function useToast() {
  return {
    toast: (options: ToastOptions) => {
      const { title, description, variant = 'default', duration = 3000 } = options;
      const message = title ? `${title}${description ? ': ' + description : ''}` : description;

      if (variant === 'destructive') {
        toast.error(message, { duration });
      } else {
        toast.success(message, { duration });
      }
    },
  };
}
