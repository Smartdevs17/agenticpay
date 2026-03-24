
"use client";

import PWAInstallPrompt from "./PWAInstallPrompt";
import {SWRegister} from "./SWRegister";

export default function PWAWrapper() {
  return (
    <>
      <SWRegister />
      <PWAInstallPrompt />
    </>
  );
}