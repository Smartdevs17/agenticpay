"use client";

import { useEffect, useMemo, useState } from "react";
import { getWebSocketPool, type WebSocketPoolOptions } from "@/lib/websocket/pool";

export function useWebSocketPool(options: WebSocketPoolOptions) {
  const pool = useMemo(() => getWebSocketPool(options), [options.url]);
  const [state, setState] = useState({ connected: false, reconnecting: false, lastError: undefined as string | undefined });
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribeState = pool.onState(setState);
    const unsubscribeMessage = pool.onMessage((msg) => setLastMessage(msg));
    pool.connect();
    return () => {
      unsubscribeState();
      unsubscribeMessage();
    };
  }, [pool]);

  return {
    pool,
    state,
    lastMessage,
    send: pool.send.bind(pool),
  };
}

