"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useToast } from "@/components/ui/use-toast";

interface WebSocketNotification {
  id: string;
  title: string;
  body: string;
  category: string;
  icon?: string;
  badge?: string;
  data?: Record<string, any>;
  deepLink?: string;
  timestamp: string;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  isConnecting: boolean;
  notification: WebSocketNotification | null;
  sendMessage: (event: string, data: any, callback?: (response: any) => void) => void;
  disconnect: () => void;
}

/**
 * Hook for WebSocket real-time notifications
 */
export function useWebSocketNotifications(): UseWebSocketReturn {
  const socketRef = useRef<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [notification, setNotification] = useState<WebSocketNotification | null>(null);
  const { toast } = useToast();

  const connectWebSocket = useCallback(() => {
    if (isConnecting || isConnected || socketRef.current?.connected) {
      return;
    }

    setIsConnecting(true);

    try {
      // Dynamically import socket.io client
      const io = require("socket.io-client").io || window.io;

      if (!io) {
        console.error("Socket.io client not available");
        setIsConnecting(false);
        return;
      }

      const token = localStorage.getItem("auth_token");
      const userId = localStorage.getItem("user_id");
      const tenantId = localStorage.getItem("tenant_id");

      const socket = io(process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001", {
        auth: {
          token,
          userId,
          tenantId,
        },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      socket.on("connect", () => {
        console.log("[WebSocket] Connected");
        setIsConnected(true);
        setIsConnecting(false);
      });

      socket.on("notification:new", (data: WebSocketNotification) => {
        console.log("[WebSocket] Received notification:", data);
        setNotification(data);

        // Show toast
        toast({
          title: data.title,
          description: data.body,
        });
      });

      socket.on("disconnect", () => {
        console.log("[WebSocket] Disconnected");
        setIsConnected(false);
      });

      socket.on("error", (error: string) => {
        console.error("[WebSocket] Error:", error);
        toast({
          title: "Connection Error",
          description: error,
          variant: "destructive",
        });
      });

      socket.on("connect_error", (error: Error) => {
        console.error("[WebSocket] Connect error:", error);
        setIsConnecting(false);
      });

      socketRef.current = socket;
    } catch (error) {
      console.error("[WebSocket] Setup error:", error);
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected, toast]);

  const sendMessage = useCallback(
    (event: string, data: any, callback?: (response: any) => void) => {
      if (!socketRef.current?.connected) {
        console.warn("[WebSocket] Not connected");
        return;
      }

      socketRef.current.emit(event, data, callback);
    },
    []
  );

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      setIsConnected(false);
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connectWebSocket();

    return () => {
      disconnect();
    };
  }, [connectWebSocket, disconnect]);

  return {
    isConnected,
    isConnecting,
    notification,
    sendMessage,
    disconnect,
  };
}

/**
 * Component that integrates WebSocket notifications with the app
 */
export function WebSocketNotificationProvider({ children }: { children: React.ReactNode }) {
  const { isConnected, notification } = useWebSocketNotifications();

  useEffect(() => {
    if (!isConnected) {
      console.log("[WebSocket] Reconnecting...");
    }
  }, [isConnected]);

  return (
    <>
      {children}
      {/* Optional: Display connection status indicator */}
      <div className="fixed bottom-0 right-0 p-4 text-xs text-gray-600">
        <div className={`h-2 w-2 rounded-full inline-block mr-1 ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
        {isConnected ? "Connected" : "Disconnected"}
      </div>
    </>
  );
}

/**
 * Hook to subscribe to push notifications via WebSocket
 */
export function useWebSocketPushSubscribe() {
  const { sendMessage } = useWebSocketNotifications();
  const { toast } = useToast();

  const subscribe = useCallback(
    async (subscription: PushSubscriptionJSON) => {
      return new Promise((resolve, reject) => {
        sendMessage("notification:subscribe", { subscription }, (response) => {
          if (response.error) {
            toast({
              title: "Subscription Failed",
              description: response.error,
              variant: "destructive",
            });
            reject(new Error(response.error));
          } else {
            resolve(response.subscriptionId);
          }
        });
      });
    },
    [sendMessage, toast]
  );

  const unsubscribe = useCallback(
    async (endpoint: string) => {
      return new Promise((resolve, reject) => {
        sendMessage("notification:unsubscribe", { endpoint }, (response) => {
          if (response.error) {
            toast({
              title: "Unsubscribe Failed",
              description: response.error,
              variant: "destructive",
            });
            reject(new Error(response.error));
          } else {
            resolve(true);
          }
        });
      });
    },
    [sendMessage, toast]
  );

  return { subscribe, unsubscribe };
}

/**
 * Hook to manage preferences via WebSocket
 */
export function useWebSocketPreferences() {
  const { sendMessage } = useWebSocketNotifications();
  const { toast } = useToast();

  const getPreferences = useCallback(async () => {
    return new Promise((resolve, reject) => {
      sendMessage("notification:preferences", {}, (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.preferences);
        }
      });
    });
  }, [sendMessage]);

  const updatePreferences = useCallback(
    async (preferences: Record<string, any>) => {
      return new Promise((resolve, reject) => {
        sendMessage("notification:updatePreferences", preferences, (response) => {
          if (response.error) {
            toast({
              title: "Update Failed",
              description: response.error,
              variant: "destructive",
            });
            reject(new Error(response.error));
          } else {
            toast({
              title: "Success",
              description: "Preferences updated",
            });
            resolve(response.preferences);
          }
        });
      });
    },
    [sendMessage, toast]
  );

  const markAsRead = useCallback(
    async (notificationId: string) => {
      return new Promise((resolve, reject) => {
        sendMessage("notification:markAsRead", { notificationId }, (response) => {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(true);
          }
        });
      });
    },
    [sendMessage]
  );

  return { getPreferences, updatePreferences, markAsRead };
}
