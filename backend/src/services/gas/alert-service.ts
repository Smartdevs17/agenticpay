export interface AlertThreshold {
  network: string;
  thresholdGwei: number;
  callback: (network: string, currentGwei: number) => void;
}

const thresholds: AlertThreshold[] = [];

function register(threshold: AlertThreshold): void {
  thresholds.push(threshold);
}

function checkAlerts(network: string, currentGwei: number): void {
  for (const t of thresholds) {
    if (t.network === network && currentGwei > t.thresholdGwei) {
      try {
        t.callback(network, currentGwei);
      } catch {
        // Never let alert callbacks crash the caller
      }
    }
  }
}

function unregister(network: string): void {
  const idx = thresholds.findIndex((t) => t.network === network);
  if (idx !== -1) thresholds.splice(idx, 1);
}

export const gasAlertService = { register, checkAlerts, unregister };
