"use client";

import { useCallback, useEffect, useState } from "react";

export type NotificationChannel = "email" | "sms" | "push" | "inApp" | "whatsapp";
export type NotificationCategory =
  | "payments"
  | "invoices"
  | "marketing"
  | "security"
  | "productUpdates";

export type PreferenceMatrixData = Record<
  NotificationChannel,
  Record<NotificationCategory, boolean>
>;

const CHANNELS: NotificationChannel[] = ["email", "sms", "push", "inApp", "whatsapp"];
const CATEGORIES: NotificationCategory[] = [
  "payments",
  "invoices",
  "marketing",
  "security",
  "productUpdates",
];

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
  inApp: "In-app",
  whatsapp: "WhatsApp",
};

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  payments: "Payments",
  invoices: "Invoices",
  marketing: "Marketing",
  security: "Security",
  productUpdates: "Product updates",
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

function emptyMatrix(enabled = true): PreferenceMatrixData {
  const matrix = {} as PreferenceMatrixData;
  for (const channel of CHANNELS) {
    matrix[channel] = {} as Record<NotificationCategory, boolean>;
    for (const category of CATEGORIES) {
      matrix[channel][category] = enabled && category !== "marketing";
    }
  }
  return matrix;
}

export type PreferenceMatrixProps = {
  userId?: string;
  initialMatrix?: PreferenceMatrixData;
  onChange?: (matrix: PreferenceMatrixData) => void;
};

/**
 * Channel × category preference matrix for multi-channel notifications (#1352).
 */
export function PreferenceMatrixPanel({
  userId,
  initialMatrix,
  onChange,
}: PreferenceMatrixProps) {
  const [matrix, setMatrix] = useState<PreferenceMatrixData>(
    initialMatrix ?? emptyMatrix()
  );
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const response = await fetch(
          `${API_BASE_URL}/notifications/preferences/matrix?userId=${encodeURIComponent(userId!)}`,
          {
            headers: {
              Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("auth_token") : ""}`,
            },
          }
        );
        if (!response.ok) throw new Error("Failed to load preference matrix");
        const data = (await response.json()) as PreferenceMatrixData;
        if (!cancelled) {
          setMatrix(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load matrix");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggle = useCallback(
    (channel: NotificationChannel, category: NotificationCategory) => {
      setMatrix((prev) => {
        const next: PreferenceMatrixData = {
          ...prev,
          [channel]: {
            ...prev[channel],
            [category]: !prev[channel][category],
          },
        };
        onChange?.(next);
        setSaved(false);
        return next;
      });
    },
    [onChange]
  );

  const save = async () => {
    if (!userId) {
      onChange?.(matrix);
      setSaved(true);
      return;
    }
    try {
      setIsSaving(true);
      const response = await fetch(`${API_BASE_URL}/notifications/preferences/matrix`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("auth_token") : ""}`,
        },
        body: JSON.stringify({ userId, matrix }),
      });
      if (!response.ok) throw new Error("Failed to save preference matrix");
      setSaved(true);
      setError(null);
      onChange?.(matrix);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save matrix");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="notification-matrix notification-matrix--loading" role="status">
        Loading notification preferences…
      </div>
    );
  }

  return (
    <div className="notification-matrix space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Notification preferences</h2>
        <p className="text-sm text-muted-foreground">
          Choose which channels receive each category of alert.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left font-medium">Channel</th>
              {CATEGORIES.map((category) => (
                <th key={category} className="p-2 text-left font-medium">
                  {CATEGORY_LABELS[category]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map((channel) => (
              <tr key={channel} className="border-t border-border/60">
                <td className="p-2 font-medium">{CHANNEL_LABELS[channel]}</td>
                {CATEGORIES.map((category) => (
                  <td key={category} className="p-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={matrix[channel][category]}
                        onChange={() => toggle(channel, category)}
                        aria-label={`${CHANNEL_LABELS[channel]} — ${CATEGORY_LABELS[category]}`}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={isSaving}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save preferences"}
        </button>
        {saved ? (
          <span className="text-sm text-muted-foreground" role="status">
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** @deprecated Prefer PreferenceMatrixPanel — kept for issue #1352 scope naming. */
export const PreferenceMatrix = PreferenceMatrixPanel;
