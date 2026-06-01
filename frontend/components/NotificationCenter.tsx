"use client";

import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: string;
  title: string;
  body: string;
  category: string;
  status: string;
  icon?: string;
  badge?: string;
  tag?: string;
  deepLink?: string;
  sentAt?: string;
  deliveredAt?: string;
  clickedAt?: string;
  data?: Record<string, any>;
  createdAt: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

/**
 * Component to display notification history
 */
export function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/push/history?limit=50`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch notifications");
      }

      const data = await response.json();
      setNotifications(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching notifications:", err);
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      payment_notification: "bg-green-100 text-green-800",
      dispute_alert: "bg-red-100 text-red-800",
      project_update: "bg-blue-100 text-blue-800",
      milestone_reminder: "bg-purple-100 text-purple-800",
      security_alert: "bg-orange-100 text-orange-800",
      subscription_update: "bg-indigo-100 text-indigo-800",
      system_notification: "bg-gray-100 text-gray-800",
    };
    return colors[category] || "bg-gray-100 text-gray-800";
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; color: string }> = {
      pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800" },
      sent: { label: "Sent", color: "bg-blue-100 text-blue-800" },
      delivered: { label: "Delivered", color: "bg-green-100 text-green-800" },
      clicked: { label: "Clicked", color: "bg-purple-100 text-purple-800" },
      failed: { label: "Failed", color: "bg-red-100 text-red-800" },
    };
    const info = statusMap[status] || statusMap.pending;
    return info;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">{error}</p>
        <button
          onClick={fetchNotifications}
          className="mt-2 text-sm font-medium text-red-600 hover:text-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
        <p className="text-gray-600">No notifications yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notifications.map((notification) => {
        const status = getStatusBadge(notification.status);
        return (
          <div
            key={notification.id}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{notification.title}</h3>
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${getCategoryColor(notification.category)}`}>
                    {notification.category.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{notification.body}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                  <span>{formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}</span>
                  <span>•</span>
                  <span className={`inline-block rounded px-2 py-0.5 ${status.color}`}>
                    {status.label}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Notification Toast Component
 */
export function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
      {notification.icon && (
        <img src={notification.icon} alt="" className="h-8 w-8 flex-shrink-0" />
      )}
      <div className="flex-1">
        <h4 className="font-medium text-gray-900">{notification.title}</h4>
        <p className="mt-1 text-sm text-gray-600">{notification.body}</p>
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}

/**
 * In-App Notification Container - manages multiple toasts
 */
export function NotificationContainer() {
  const [toasts, setToasts] = useState<Notification[]>([]);

  useEffect(() => {
    // Listen for broadcast messages from service worker or other sources
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_RECEIVED") {
        const notification = event.data.notification;
        setToasts((prev) => [...prev, notification]);
      }
    };

    navigator.serviceWorker?.controller?.addEventListener("message", handleMessage);

    return () => {
      navigator.serviceWorker?.controller?.removeEventListener("message", handleMessage);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((toast) => (
        <NotificationToast
          key={toast.id}
          notification={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
