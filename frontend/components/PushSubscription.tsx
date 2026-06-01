"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/ui/use-toast";

interface PushSubscriptionStatus {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  permission: NotificationPermission;
}

interface UseNotificationSubscriptionReturn extends PushSubscriptionStatus {
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  requestPermission: () => Promise<void>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

/**
 * Hook to manage push notification subscriptions
 */
export function useNotificationSubscription(): UseNotificationSubscriptionReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const { toast } = useToast();

  // Check browser support
  useEffect(() => {
    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setIsSupported(supported);
    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  // Check current subscription status
  useEffect(() => {
    if (!isSupported) return;

    const checkSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      } catch (error) {
        console.error("Error checking subscription:", error);
      }
    };

    checkSubscription();
  }, [isSupported]);

  /**
   * Request notification permission from user
   */
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      toast({
        title: "Not Supported",
        description: "Push notifications are not supported in this browser",
        variant: "destructive",
      });
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermission(permission);

      if (permission === "granted") {
        toast({
          title: "Permission Granted",
          description: "You will now receive push notifications",
        });
      } else if (permission === "denied") {
        toast({
          title: "Permission Denied",
          description: "Push notifications are disabled. You can enable them in settings.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      toast({
        title: "Error",
        description: "Failed to request notification permission",
        variant: "destructive",
      });
    }
  }, [isSupported, toast]);

  /**
   * Subscribe to push notifications
   */
  const subscribe = useCallback(async () => {
    if (!isSupported) {
      toast({
        title: "Not Supported",
        description: "Push notifications are not supported in this browser",
        variant: "destructive",
      });
      return;
    }

    if (permission !== "granted") {
      await requestPermission();
      return;
    }

    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;

      // Get VAPID public key
      const keyResponse = await fetch(`${API_BASE_URL}/push/vapid-public-key`);
      const { publicKey } = await keyResponse.json();

      // Create push subscription
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to backend
      const response = await fetch(`${API_BASE_URL}/push/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: JSON.stringify({ subscription }),
      });

      if (!response.ok) {
        throw new Error("Failed to save subscription to server");
      }

      const data = await response.json();
      setIsSubscribed(true);

      toast({
        title: "Subscribed",
        description: "You are now subscribed to push notifications",
      });

      // Store subscription locally for reference
      localStorage.setItem("push_subscription_id", data.subscriptionId);
    } catch (error) {
      console.error("Error subscribing:", error);
      toast({
        title: "Subscription Failed",
        description: "Failed to subscribe to push notifications. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, permission, requestPermission, toast]);

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;

    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setIsSubscribed(false);
        return;
      }

      // Send unsubscribe request to backend
      await fetch(`${API_BASE_URL}/push/unsubscribe`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      // Unsubscribe from push manager
      await subscription.unsubscribe();
      setIsSubscribed(false);

      localStorage.removeItem("push_subscription_id");

      toast({
        title: "Unsubscribed",
        description: "You have been unsubscribed from push notifications",
      });
    } catch (error) {
      console.error("Error unsubscribing:", error);
      toast({
        title: "Unsubscription Failed",
        description: "Failed to unsubscribe from push notifications",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, toast]);

  return {
    isSupported,
    isSubscribed,
    isLoading,
    permission,
    subscribe,
    unsubscribe,
    requestPermission,
  };
}

/**
 * Component for managing push notification subscription
 */
export function PushNotificationManager() {
  const {
    isSupported,
    isSubscribed,
    isLoading,
    permission,
    subscribe,
    unsubscribe,
    requestPermission,
  } = useNotificationSubscription();

  if (!isSupported) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {permission === "default" && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            Enable push notifications to receive real-time updates about payments, disputes, and more.
          </p>
          <button
            onClick={requestPermission}
            disabled={isLoading}
            className="mt-2 rounded bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
          >
            Enable Notifications
          </button>
        </div>
      )}

      {permission === "granted" && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-600" />
            <p className="text-sm text-green-800">
              {isSubscribed
                ? "Push notifications are enabled"
                : "Push notifications are ready to enable"}
            </p>
          </div>
          <button
            onClick={isSubscribed ? unsubscribe : subscribe}
            disabled={isLoading}
            className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              isSubscribed
                ? "bg-red-600 hover:bg-red-700"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {isLoading ? "Loading..." : isSubscribed ? "Disable" : "Enable"}
          </button>
        </div>
      )}

      {permission === "denied" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            Push notifications are disabled. You can enable them in your browser settings.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Helper function to convert VAPID key to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Simple button component for toggling notifications
 */
export function NotificationToggle() {
  const {
    isSupported,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    permission,
  } = useNotificationSubscription();

  if (!isSupported || permission !== "granted") {
    return null;
  }

  return (
    <button
      onClick={isSubscribed ? unsubscribe : subscribe}
      disabled={isLoading}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      title={isSubscribed ? "Disable notifications" : "Enable notifications"}
    >
      <svg
        className={`h-4 w-4 ${isSubscribed ? "fill-current" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path
          d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {isSubscribed ? "Notifications On" : "Notifications Off"}
    </button>
  );
}
