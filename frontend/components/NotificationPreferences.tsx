"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";

interface NotificationPreferences {
  paymentNotifications: boolean;
  disputeAlerts: boolean;
  projectUpdates: boolean;
  milestoneReminders: boolean;
  securityAlerts: boolean;
  subscriptionUpdates: boolean;
  systemNotifications: boolean;
  groupNotifications: boolean;
  notifySound: boolean;
  notifyBadge: boolean;
  locale: string;
  timezone: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

/**
 * Component for managing notification preferences
 */
export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/push/preferences`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch preferences");
      }

      const data = await response.json();
      setPreferences(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching preferences:", err);
      setError(err instanceof Error ? err.message : "Failed to load preferences");
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = (key: keyof NotificationPreferences) => {
    if (preferences) {
      const updated = {
        ...preferences,
        [key]: !preferences[key],
      };
      setPreferences(updated);
    }
  };

  const handleSelectChange = (key: keyof NotificationPreferences, value: string) => {
    if (preferences) {
      const updated = {
        ...preferences,
        [key]: value,
      };
      setPreferences(updated);
    }
  };

  const savePreferences = async () => {
    if (!preferences) return;

    try {
      setIsSaving(true);
      const response = await fetch(`${API_BASE_URL}/push/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        throw new Error("Failed to save preferences");
      }

      toast({
        title: "Success",
        description: "Notification preferences updated",
      });
    } catch (err) {
      console.error("Error saving preferences:", err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save preferences",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  if (error || !preferences) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">{error || "Failed to load preferences"}</p>
        <button
          onClick={fetchPreferences}
          className="mt-2 text-sm font-medium text-red-600 hover:text-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const categoryPreferences = [
    {
      key: "paymentNotifications" as const,
      label: "Payment Notifications",
      description: "Receive notifications when payments are processed or completed",
    },
    {
      key: "disputeAlerts" as const,
      label: "Dispute Alerts",
      description: "Get alerts about disputes or issues with your payments",
    },
    {
      key: "projectUpdates" as const,
      label: "Project Updates",
      description: "Receive updates about project status and changes",
    },
    {
      key: "milestoneReminders" as const,
      label: "Milestone Reminders",
      description: "Get reminders about upcoming project milestones",
    },
    {
      key: "securityAlerts" as const,
      label: "Security Alerts",
      description: "Important security and account notifications",
    },
    {
      key: "subscriptionUpdates" as const,
      label: "Subscription Updates",
      description: "Updates about your subscription plans and billing",
    },
    {
      key: "systemNotifications" as const,
      label: "System Notifications",
      description: "General system and maintenance updates",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Notification Categories */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Notification Categories</h3>
        <p className="mt-1 text-sm text-gray-600">
          Choose which types of notifications you want to receive
        </p>

        <div className="mt-4 space-y-3">
          {categoryPreferences.map((category) => (
            <label
              key={category.key}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={preferences[category.key]}
                onChange={() => handleToggle(category.key)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">{category.label}</p>
                <p className="text-sm text-gray-600">{category.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Notification Features */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Notification Features</h3>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.groupNotifications}
              onChange={() => handleToggle("groupNotifications")}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <div className="flex-1">
              <p className="font-medium text-gray-900">Group Similar Notifications</p>
              <p className="text-sm text-gray-600">
                Combine similar notifications into a single notification
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.notifySound}
              onChange={() => handleToggle("notifySound")}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <div className="flex-1">
              <p className="font-medium text-gray-900">Sound</p>
              <p className="text-sm text-gray-600">Play a sound when notifications arrive</p>
            </div>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.notifyBadge}
              onChange={() => handleToggle("notifyBadge")}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <div className="flex-1">
              <p className="font-medium text-gray-900">Badge</p>
              <p className="text-sm text-gray-600">Show notification badge on app icon</p>
            </div>
          </label>
        </div>
      </div>

      {/* Regional Settings */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Regional Settings</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Language</label>
            <select
              value={preferences.locale}
              onChange={(e) => handleSelectChange("locale", e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="ja">Japanese</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Timezone</label>
            <select
              value={preferences.timezone}
              onChange={(e) => handleSelectChange("timezone", e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="UTC">UTC (Universal)</option>
              <option value="America/New_York">Eastern (ET)</option>
              <option value="America/Chicago">Central (CT)</option>
              <option value="America/Denver">Mountain (MT)</option>
              <option value="America/Los_Angeles">Pacific (PT)</option>
              <option value="Europe/London">London (GMT)</option>
              <option value="Europe/Paris">Paris (CET)</option>
              <option value="Asia/Tokyo">Tokyo (JST)</option>
              <option value="Australia/Sydney">Sydney (AEDT)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-2">
        <button
          onClick={fetchPreferences}
          disabled={isSaving}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Reset
        </button>
        <button
          onClick={savePreferences}
          disabled={isSaving}
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Preferences"}
        </button>
      </div>
    </div>
  );
}

/**
 * Simpler toggle component for notification settings in header/navigation
 */
export function NotificationPreferenceQuickToggle() {
  const [preferences, setPreferences] = useState<Partial<NotificationPreferences>>({
    paymentNotifications: true,
    disputeAlerts: true,
    securityAlerts: true,
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();

  const handleToggle = async (key: string) => {
    const updated = {
      ...preferences,
      [key]: !preferences[key as keyof NotificationPreferences],
    };
    setPreferences(updated);

    try {
      const response = await fetch(`${API_BASE_URL}/push/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: JSON.stringify(updated),
      });

      if (!response.ok) {
        throw new Error("Failed to update");
      }
    } catch (err) {
      console.error("Error:", err);
      toast({
        title: "Error",
        description: "Failed to update preferences",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isExpanded && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-4 space-y-3">
            {Object.entries({
              paymentNotifications: "Payments",
              disputeAlerts: "Disputes",
              securityAlerts: "Security",
            }).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferences[key as keyof NotificationPreferences] || false}
                  onChange={() => handleToggle(key)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
