
"use client";

import PWAInstallPrompt from "./PWAInstallPrompt";
import {SWRegister} from "./SWRegister";
import { OfflineBanner } from "./offline/OfflineBanner";

export default function PWAWrapper() {
  return (
    <>
      <SWRegister />
      <OfflineBanner />
      <PWAInstallPrompt />
    </>
  );
}
