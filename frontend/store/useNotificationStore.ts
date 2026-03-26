import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationSettings {
  transactionConfirmed: boolean;
  projectStatusChange: boolean;
  newInvoice: boolean;
}

interface NotificationStore {
  enabled: boolean;
  settings: NotificationSettings;
  setEnabled: (enabled: boolean) => void;
  updateSetting: (key: keyof NotificationSettings, value: boolean) => void;
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set) => ({
      enabled: true,
      settings: {
        transactionConfirmed: true,
        projectStatusChange: true,
        newInvoice: true,
      },
      setEnabled: (enabled) => set({ enabled }),
      updateSetting: (key, value) =>
        set((state) => ({
          settings: { ...state.settings, [key]: value },
        })),
    }),
    { name: 'agenticpay-notifications' }
  )
);