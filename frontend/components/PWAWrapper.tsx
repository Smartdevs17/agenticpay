"use client";

import { useEffect, useState } from "react";
import PWAInstallPrompt from "./PWAInstallPrompt";
import { SWRegister, useServiceWorker } from "./SWRegister";
import { OfflineBanner } from "./offline/OfflineBanner";

function SWUpdateNotification() {
  const { updateEvent, applyUpdate } = useServiceWorker();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (updateEvent) {
      setVisible(true);
    }
  }, [updateEvent]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3">
      <span className="text-sm">A new version is available.</span>
      <button
        onClick={() => {
          applyUpdate();
          setVisible(false);
        }}
        className="bg-white text-blue-600 px-3 py-1 rounded text-sm font-medium hover:bg-blue-50 transition-colors"
      >
        Update
      </button>
      <button
        onClick={() => setVisible(false)}
        className="text-white/80 hover:text-white text-sm"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}

export default function PWAWrapper() {
  return (
    <>
      <SWRegister />
      <OfflineBanner />
      <PWAInstallPrompt />
      <SWUpdateNotification />
    </>
  );
}
