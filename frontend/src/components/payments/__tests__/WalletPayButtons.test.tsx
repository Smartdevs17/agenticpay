import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WalletPayButtons,
  detectApplePay,
  detectGooglePay,
  formatWalletAmount,
} from '../WalletPayButtons';

const render = (props: Parameters<typeof WalletPayButtons>[0]) =>
  renderToStaticMarkup(<WalletPayButtons {...props} />);

describe('WalletPayButtons (#916)', () => {
  it('renders both wallet buttons when both providers are available', () => {
    const html = render({ amount: 42.5, applePayAvailable: true, googlePayAvailable: true });

    expect(html).toContain('data-testid="wallet-pay-buttons"');
    expect(html).toContain('data-testid="apple-pay-button"');
    expect(html).toContain('data-testid="google-pay-button"');
    expect(html).toContain('Pay with Apple Pay');
    expect(html).toContain('Pay with Google Pay');
  });

  it('labels the buttons with the formatted amount and currency', () => {
    const html = render({
      amount: 42.5,
      currency: 'EUR',
      applePayAvailable: true,
      googlePayAvailable: false,
    });

    expect(html).toContain('€42.50');
    expect(html).not.toContain('data-testid="google-pay-button"');
  });

  it('renders only Google Pay when Apple Pay is unavailable', () => {
    const html = render({ amount: 10, applePayAvailable: false, googlePayAvailable: true });

    expect(html).not.toContain('data-testid="apple-pay-button"');
    expect(html).toContain('data-testid="google-pay-button"');
  });

  it('shows a fallback message when no wallet is available', () => {
    const html = render({ amount: 10, applePayAvailable: false, googlePayAvailable: false });

    expect(html).toContain('not available on this device');
    expect(html).not.toContain('data-testid="apple-pay-button"');
  });

  it('disables the buttons when requested', () => {
    const html = render({
      amount: 10,
      applePayAvailable: true,
      googlePayAvailable: true,
      disabled: true,
    });

    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it('formats amounts, falling back safely for unknown currencies', () => {
    expect(formatWalletAmount(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatWalletAmount(10, 'NOT_A_CURRENCY')).toBe('10 NOT_A_CURRENCY');
  });

  it('detects unavailable wallet APIs in a non-browser environment', () => {
    expect(detectApplePay()).toBe(false);
    expect(detectGooglePay()).toBe(false);
  });
});
