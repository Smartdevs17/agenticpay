"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pwa-install-dismissed";

export default function PWAInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if dismissed before
    if (localStorage.getItem(STORAGE_KEY)) return;

    // Don't show if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const handler = (e: any) => {
      e.preventDefault();
      setPromptEvent(e);
      setVisible(true);
    };

    localStorage.removeItem("pwa-install-dismissed")
    
    window.addEventListener("beforeinstallprompt", handler);

    return () =>
      window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const installApp = async () => {
    if (!promptEvent) return;

    promptEvent.prompt();
    const result = await promptEvent.userChoice;

    if (result.outcome === "accepted") {
      setVisible(false);
    }

    setPromptEvent(null);
  };

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-black text-white px-6 py-4 rounded-xl shadow-lg flex items-center gap-4">
      <p className="text-sm">
        Install AgenticPay for a faster experience 🚀
      </p>

      <button
        onClick={installApp}
        className="bg-white text-black px-4 py-2 rounded-md text-sm font-medium"
      >
        Install
      </button>

      <button
        onClick={dismiss}
        className="text-gray-400 text-sm"
      >
        Dismiss
      </button>
    </div>
  );
}