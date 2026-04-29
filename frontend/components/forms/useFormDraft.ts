import { useEffect } from 'react';
import { UseFormReset, UseFormWatch } from 'react-hook-form';

export function useFormDraft<T extends Record<string, unknown>>(
  formId: string,
  watch: UseFormWatch<T>,
  reset: UseFormReset<T>,
) {
  const storageKey = `agenticpay-form-draft:${formId}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as T;
      reset(parsed);
    } catch {
      // Ignore invalid draft data
    }
  }, [reset, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const subscription = watch((values) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(values));
      } catch {
        // Local storage may be unavailable in some environments.
      }
    });

    return () => subscription.unsubscribe();
  }, [watch, storageKey]);
}
