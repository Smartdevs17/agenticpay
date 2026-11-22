import type { InvoiceRecord, InvoiceLineItem } from '../invoice.js';
import type { InvoiceViewModel, InvoiceViewModelLineItem, InvoiceViewModelTaxBreakdown } from './types.js';

/**
 * Sanitizes user-supplied text ensuring safe plain text rendering:
 * strips harmful control codes while preserving legitimate Unicode and whitespace.
 */
export function sanitizePlainText(input: unknown): string {
  if (typeof input !== 'string') {
    return input === null || input === undefined ? '' : String(input);
  }
  // Strip control characters except newline and tab
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Formats a monetary amount with 2 decimal places using deterministic string math.
 * Avoids JavaScript floating point rounding artifacts.
 */
export function formatMoneyAmount(amount: number): string {
  if (Number.isNaN(amount) || !Number.isFinite(amount)) {
    return '0.00';
  }
  return amount.toFixed(2);
}

/**
 * Formats money with currency code (e.g. "123.45 USD").
 */
export function formatCurrencyAmount(amount: number, currency: string): string {
  return `${formatMoneyAmount(amount)} ${sanitizePlainText(currency).trim()}`;
}

export function buildInvoiceViewModel(invoice: InvoiceRecord): InvoiceViewModel {
  const currency = sanitizePlainText(invoice.currency || 'USD').trim();
  const taxRatePercent = invoice.taxBreakdown?.[0]?.rate ?? 0;

  const lineItems: InvoiceViewModelLineItem[] = (invoice.lineItems || []).map((item: InvoiceLineItem) => {
    const description = sanitizePlainText(item.description || 'Line item');
    const hours = Number(item.hours ?? 0);
    const rate = Number(item.rate ?? 0);
    const amount = Number(item.amount ?? hours * rate);
    const rateFormatted = formatMoneyAmount(rate);
    const amountFormatted = formatMoneyAmount(amount);

    return {
      description,
      hours,
      rate,
      amount,
      rateFormatted,
      amountFormatted,
      formattedLine: `${description} — ${hours}h @ ${rateFormatted} = ${amountFormatted} ${currency}`,
    };
  });

  const taxBreakdown: InvoiceViewModelTaxBreakdown[] = (invoice.taxBreakdown || []).map((tax) => ({
    countryCode: sanitizePlainText(tax.countryCode),
    rate: Number(tax.rate ?? 0),
    rateFormatted: `${Number(tax.rate ?? 0)}%`,
    amount: Number(tax.amount ?? 0),
    amountFormatted: formatMoneyAmount(Number(tax.amount ?? 0)),
    currency: sanitizePlainText(tax.currency || currency),
    description: sanitizePlainText(tax.description),
  }));

  const subtotal = Number(invoice.subtotal ?? 0);
  const taxTotal = Number(invoice.taxTotal ?? 0);
  const total = Number(invoice.total ?? subtotal + taxTotal);

  return {
    id: sanitizePlainText(invoice.id),
    invoiceNumber: sanitizePlainText(invoice.invoiceNumber),
    merchantId: sanitizePlainText(invoice.merchantId),
    projectId: sanitizePlainText(invoice.projectId),
    generatedAt: sanitizePlainText(invoice.generatedAt),
    currency,
    lineItems,
    subtotal,
    subtotalFormatted: `${formatMoneyAmount(subtotal)} ${currency}`,
    taxRatePercent,
    taxTotal,
    taxTotalFormatted: `${formatMoneyAmount(taxTotal)} ${currency}`,
    total,
    totalFormatted: `${formatMoneyAmount(total)} ${currency}`,
    summary: sanitizePlainText(invoice.summary || ''),
    status: sanitizePlainText(invoice.status || 'pending'),
    countryCode: sanitizePlainText(invoice.countryCode || 'US'),
    taxBreakdown,
  };
}
