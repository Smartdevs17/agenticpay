'use client';

import { useNotificationStore } from '@/store/useNotificationStore';

export function NotificationSettings() {
  const { enabled, settings, setEnabled, updateSetting } = useNotificationStore();

  const items = [
    { key: 'transactionConfirmed' as const, label: 'Transaction confirmed' },
    { key: 'projectStatusChange' as const, label: 'Project status changes' },
    { key: 'newInvoice' as const, label: 'New invoice generated' },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Notifications</p>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEnabled(!enabled);
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            enabled ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-2">
          {items.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <p className="text-xs text-gray-600">{label}</p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateSetting(key, !settings[key]);
                }}
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                  settings[key] ? 'bg-blue-500' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
                    settings[key] ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
