"use client";

import { useEffect, useState, useCallback } from "react";

interface SWUpdateEvent {
  registration: ServiceWorkerRegistration;
  onUpdate: () => void;
}

export function useServiceWorker() {
  const [updateEvent, setUpdateEvent] = useState<SWUpdateEvent | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/service-worker.js");
        setRegistration(reg);
        setIsRegistered(true);

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateEvent({
                registration: reg,
                onUpdate: () => {
                  newWorker.postMessage({ type: "SKIP_WAITING" });
                },
              });
            }
          });
        });
      } catch (err) {
        console.log("SW registration failed:", err);
      }
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  const applyUpdate = useCallback(() => {
    if (!updateEvent) return;
    updateEvent.onUpdate();
    setUpdateEvent(null);
    window.location.reload();
  }, [updateEvent]);

  return { isRegistered, registration, updateEvent, applyUpdate };
}

export function SWRegister() {
  const { isRegistered } = useServiceWorker();

  useEffect(() => {
    if (isRegistered) {
      console.log("SW registered successfully");
    }
  }, [isRegistered]);

  return null;
}
