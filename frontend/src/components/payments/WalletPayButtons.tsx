'use client';

import { cn } from '@/lib/utils';

export type WalletProviderOption = 'apple_pay' | 'google_pay';

export interface WalletPayButtonsProps {
  /** Amount to charge, in major currency units (e.g. 42.5). */
  amount: number;
  /** ISO-4217 currency code. Defaults to USD. */
  currency?: string;
  /** Force Apple Pay availability; when omitted the browser is feature-detected. */
  applePayAvailable?: boolean;
  /** Force Google Pay availability; when omitted the browser is feature-detected. */
  googlePayAvailable?: boolean;
  onApplePay?: () => void | Promise<void>;
  onGooglePay?: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

/** True when the current browser exposes the Apple Pay JS API. */
export function detectApplePay(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as { ApplePaySession?: unknown }).ApplePaySession !== 'undefined';
}

/** True when the current browser exposes the Payment Request API used by Google Pay. */
export function detectGooglePay(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as { PaymentRequest?: unknown }).PaymentRequest !== 'undefined';
}

export function formatWalletAmount(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * Apple Pay and Google Pay checkout buttons.
 *
 * Availability is feature-detected in the browser but can be overridden with
 * the `applePayAvailable` / `googlePayAvailable` props (handy for SSR and tests).
 */
export function WalletPayButtons({
  amount,
  currency = 'USD',
  applePayAvailable,
  googlePayAvailable,
  onApplePay,
  onGooglePay,
  disabled = false,
  className,
}: WalletPayButtonsProps) {
  const appleAvailable = applePayAvailable ?? detectApplePay();
  const googleAvailable = googlePayAvailable ?? detectGooglePay();
  const formattedAmount = formatWalletAmount(amount, currency);

  if (!appleAvailable && !googleAvailable) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)} role="status">
        Apple Pay and Google Pay are not available on this device.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row', className)} data-testid="wallet-pay-buttons">
      {appleAvailable && (
        <button
          type="button"
          data-testid="apple-pay-button"
          aria-label={`Pay ${formattedAmount} with Apple Pay`}
          disabled={disabled}
          onClick={() => onApplePay?.()}
          className={cn(
            'flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-black px-6 font-medium text-white transition-opacity',
            'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <AppleGlyph />
          <span>Pay with Apple Pay</span>
        </button>
      )}

      {googleAvailable && (
        <button
          type="button"
          data-testid="google-pay-button"
          aria-label={`Pay ${formattedAmount} with Google Pay`}
          disabled={disabled}
          onClick={() => onGooglePay?.()}
          className={cn(
            'flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-border bg-white px-6 font-medium text-black transition-opacity',
            'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <GoogleGlyph />
          <span>Pay with Google Pay</span>
        </button>
      )}
    </div>
  );
}

function AppleGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M16.36 12.79c-.02-2.06 1.68-3.05 1.76-3.1-.96-1.4-2.45-1.6-2.98-1.62-1.27-.13-2.48.75-3.12.75-.64 0-1.64-.73-2.7-.71-1.39.02-2.67.81-3.38 2.05-1.44 2.5-.37 6.2 1.03 8.23.69.99 1.5 2.1 2.57 2.06 1.03-.04 1.42-.66 2.67-.66 1.24 0 1.6.66 2.69.64 1.11-.02 1.81-1 2.49-2 .79-1.15 1.11-2.27 1.13-2.33-.02-.01-2.16-.83-2.18-3.3zM14.3 6.3c.57-.69.95-1.65.85-2.6-.82.03-1.81.55-2.4 1.23-.53.61-.98 1.58-.86 2.51.91.07 1.84-.46 2.41-1.14z" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.35z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22z"
      />
      <path fill="#FBBC05" d="M6.41 13.92a5.98 5.98 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.35-2.59z" />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.35 2.59C7.2 7.72 9.4 5.96 12 5.96z"
      />
    </svg>
  );
}

export default WalletPayButtons;
