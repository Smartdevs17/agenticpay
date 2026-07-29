import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { withQueryProfiling } from '../config/database.js';
import { EmailDeliveryService } from './email-delivery.js';
import { fxService } from './fx/index.js';

let openaiClient: OpenAI | null = null;
const emailService = new EmailDeliveryService();

const TAX_RATES: Record<string, number> = {
  US: 0.10,
  GB: 0.20,
  DE: 0.19,
  FR: 0.20,
  IN: 0.18,
  CA: 0.13,
  AU: 0.10,
  NL: 0.21,
  ES: 0.21,
  IT: 0.22,
};

const getOpenAIClient = () => {
  const apiKey = config().OPENAI_API_KEY;

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceReminder {
  sentAt: string;
  type: '7_days' | '3_days' | 'overdue' | 'custom';
  message: string;
}

export type InvoiceLineItem = {
  description: string;
  hours: number;
  rate: number;
  amount: number;
  taxAmount: number;
  totalAmount: number;
};

export type InvoiceTaxBreakdown = {
  countryCode: string;
  rate: number;
  amount: number;
  currency: string;
  description: string;
};

export type InvoiceRecord = {
  id: string;
  invoiceNumber: string;
  merchantId: string;
  projectId: string;
  recipientEmail?: string;
  recipientName?: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  dueDate?: string;
  sentAt?: string;
  paidAt?: string;
  cancelledAt?: string;
  reminders: InvoiceReminder[];
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  status: InvoiceStatus;
  countryCode: string;
  taxBreakdown: InvoiceTaxBreakdown[];
  // Multi-currency FX (Issue #626) — `currency`/`total` above stay the
  // merchant's settlement currency; these track the customer-facing
  // presentment currency and the rate locked at generation/payment time.
  // Mirrors the Invoice.presentmentCurrency/presentmentAmount/fxRate/
  // fxRateLockedAt columns added to the Prisma schema for this feature.
  presentmentCurrency: string | null;
  presentmentAmount: number | null;
  fxRate: number | null;
  fxRateLockedAt: string | null;
};

export type FxLockInfo = {
  presentmentCurrency: string;
  presentmentAmount: number;
  fxRate: number;
  fxRateLockedAt: string;
};

const invoices = new Map<string, InvoiceRecord>();
const invoiceSequenceByMerchant = new Map<string, number>();

function escapePdfString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

const getTaxRateForCountry = (countryCode: string): number => {
  const normalized = countryCode.toUpperCase();
  return TAX_RATES[normalized] ?? 0.12;
};

const generateInvoiceNumber = (merchantId: string): string => {
  const normalized = merchantId.trim().toUpperCase();
  const current = invoiceSequenceByMerchant.get(normalized) ?? 0;
  const next = current + 1;
  invoiceSequenceByMerchant.set(normalized, next);
  return `INV-${normalized.slice(0, 6)}-${next.toString().padStart(4, '0')}`;
};

const buildSimplePdf = (invoice: InvoiceRecord): Buffer => {
  const lines = [
    `Invoice: ${invoice.invoiceNumber}`,
    `Merchant: ${invoice.merchantId}`,
    `Project ID: ${invoice.projectId}`,
    `Generated: ${invoice.generatedAt}`,
    `Currency: ${invoice.currency}`,
    '',
    'Line Items:',
    ...invoice.lineItems.map(
      (item) => `${item.description} — ${item.hours}h @ ${item.rate.toFixed(2)} = ${item.amount.toFixed(2)} ${invoice.currency}`
    ),
    '',
    `Subtotal: ${invoice.subtotal.toFixed(2)} ${invoice.currency}`,
    `Tax (${invoice.taxBreakdown[0]?.rate ?? 0}%): ${invoice.taxTotal.toFixed(2)} ${invoice.currency}`,
    `Total: ${invoice.total.toFixed(2)} ${invoice.currency}`,
    '',
    'Summary:',
    invoice.summary,
  ];

  const escapedLines = lines.map((line) => `(${escapePdfString(line)}) Tj T*`).join('\n');
  const content = `BT /F1 12 Tf 40 760 Td\n${escapedLines}\nET`;
  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`;
  const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

  const objects = [obj1, obj2, obj3, obj4, obj5];
  const offsets: number[] = [];
  let offset = Buffer.byteLength(header, 'latin1');
  for (const obj of objects) {
    offsets.push(offset);
    offset += Buffer.byteLength(obj, 'latin1');
  }

  const xrefLines = offsets.map((value) => value.toString().padStart(10, '0') + ' 00000 n ').join('\n');
  const xref = `xref\n0 6\n0000000000 65535 f \n${xrefLines}\n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;

  return Buffer.from(header + objects.join('') + xref + trailer, 'latin1');
};

interface InvoiceRequest {
  projectId: string;
  merchantId: string;
  workDescription: string;
  hoursWorked: number;
  hourlyRate: number;
  countryCode: string;
  /**
   * Customer-facing display currency, if different from the invoice's
   * settlement currency ('USD'). When set, the FX rate is fetched/cached via
   * `fxService` and locked onto the invoice at generation time (Issue #626).
   */
  presentmentCurrency?: string;
}

/**
 * Computes and locks the FX conversion for a multi-currency invoice against
 * its settlement `currency`/`total`, using the shared `fxService` rate
 * cache. Used both at generation time and to re-lock the rate at payment
 * time (the generation-time rate may have expired or moved by then).
 */
async function lockFxForInvoice(invoice: InvoiceRecord, presentmentCurrency: string): Promise<FxLockInfo> {
  const conversion = await fxService.convert(invoice.total, invoice.currency, presentmentCurrency);
  if (!conversion.ok) {
    throw new Error(`FX conversion failed for ${invoice.currency}->${presentmentCurrency}: ${conversion.error.message}`);
  }

  return {
    presentmentCurrency: conversion.value.quoteCurrency,
    presentmentAmount: conversion.value.convertedAmount,
    fxRate: conversion.value.rate,
    fxRateLockedAt: new Date().toISOString(),
  };
}

export async function generateInvoice(request: InvoiceRequest): Promise<InvoiceRecord> {
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const countryCode = request.countryCode?.toUpperCase() || 'US';
  const taxRate = getTaxRateForCountry(countryCode);

  let lineItems: InvoiceLineItem[] = [
    {
      description: request.workDescription,
      hours: request.hoursWorked,
      rate: request.hourlyRate,
      amount: Number((request.hoursWorked * request.hourlyRate).toFixed(2)),
      taxAmount: 0,
      totalAmount: 0,
    },
  ];
  let summary = 'Invoice generated for completed work.';

  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are an invoice generator. Given a work description, hours, and rate, generate professional line items. Respond with JSON containing lineItems (array of {description, hours, rate, amount}), summary (brief invoice summary).',
        },
        {
          role: 'user',
          content: `Work: ${request.workDescription}\nHours: ${request.hoursWorked}\nRate: $${request.hourlyRate}/hr`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const generated = JSON.parse(completion.choices[0].message.content || '{}');
    if (Array.isArray(generated.lineItems) && generated.lineItems.length > 0) {
      lineItems = generated.lineItems.map((item: any) => ({
        description: item.description || request.workDescription,
        hours: Number(item.hours ?? request.hoursWorked),
        rate: Number(item.rate ?? request.hourlyRate),
        amount: Number(item.amount ?? (request.hoursWorked * request.hourlyRate)),
        taxAmount: 0,
        totalAmount: 0,
      }));
    }

    if (generated.summary) {
      summary = String(generated.summary);
    }
  } catch {
    // Fallback to default line item if AI is unavailable.
  }

  const subtotal = Number(
    lineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2)
  );
  const taxTotal = Number((subtotal * taxRate).toFixed(2));
  const invoiceNumber = generateInvoiceNumber(request.merchantId);

  const storedLineItems = lineItems.map((item) => ({
    ...item,
    taxAmount: Number((item.amount * taxRate).toFixed(2)),
    totalAmount: Number((item.amount + item.amount * taxRate).toFixed(2)),
  }));

  const invoice: InvoiceRecord = {
    id,
    invoiceNumber,
    merchantId: request.merchantId,
    projectId: request.projectId,
    lineItems: storedLineItems,
    subtotal,
    taxTotal,
    total: Number((subtotal + taxTotal).toFixed(2)),
    currency: 'USD',
    generatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary,
    status: 'draft',
    reminders: [],
    countryCode,
    taxBreakdown: [
      {
        countryCode,
        rate: Number((taxRate * 100).toFixed(2)),
        amount: taxTotal,
        currency: 'USD',
        description: `${countryCode} VAT/GST`,
      },
    ],
    presentmentCurrency: null,
    presentmentAmount: null,
    fxRate: null,
    fxRateLockedAt: null,
  };

  const presentmentCurrency = request.presentmentCurrency?.trim().toUpperCase();
  if (presentmentCurrency && presentmentCurrency !== invoice.currency) {
    const lock = await lockFxForInvoice(invoice, presentmentCurrency);
    invoice.presentmentCurrency = lock.presentmentCurrency;
    invoice.presentmentAmount = lock.presentmentAmount;
    invoice.fxRate = lock.fxRate;
    invoice.fxRateLockedAt = lock.fxRateLockedAt;
  }

  invoices.set(invoice.id, invoice);
  return invoice;
}

export async function sendInvoiceEmail(
  invoiceId: string,
  recipientEmail: string,
  recipientName?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const invoice = invoices.get(invoiceId);
  if (!invoice) return { success: false, error: 'Invoice not found' };
  if (invoice.status === 'cancelled') return { success: false, error: 'Invoice is cancelled' };

  const pdf = buildSimplePdf(invoice);
  const result = await emailService.send({
    to: recipientEmail,
    toName: recipientName,
    subject: `Invoice ${invoice.invoiceNumber} from AgenticPay`,
    html: `
      <h2>Invoice ${invoice.invoiceNumber}</h2>
      <p>Dear ${recipientName || 'Valued Customer'},</p>
      <p>Please find attached the invoice for project <strong>${invoice.projectId}</strong>.</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
        <tr><td><strong>Subtotal</strong></td><td>$${invoice.subtotal.toFixed(2)}</td></tr>
        <tr><td><strong>Tax</strong></td><td>$${invoice.taxTotal.toFixed(2)}</td></tr>
        <tr><td><strong>Total</strong></td><td>$${invoice.total.toFixed(2)}</td></tr>
      </table>
      ${invoice.dueDate ? `<p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>` : ''}
      <p>${invoice.summary}</p>
      <hr/>
      <p style="color:#666;font-size:12px">AgenticPay - Automated Invoice System</p>
    `,
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      },
    ],
  });

  if (result.success) {
    invoice.recipientEmail = recipientEmail;
    invoice.recipientName = recipientName || undefined;
    invoice.sentAt = new Date().toISOString();
    invoice.status = 'sent';
    invoice.updatedAt = new Date().toISOString();
    invoices.set(invoiceId, invoice);
  }

  return { success: result.success, messageId: result.messageId, error: result.error };
}

export function updateInvoiceStatus(
  invoiceId: string,
  status: InvoiceStatus
): InvoiceRecord | undefined {
  const invoice = invoices.get(invoiceId);
  if (!invoice) return undefined;

  invoice.status = status;
  invoice.updatedAt = new Date().toISOString();
  if (status === 'paid') invoice.paidAt = new Date().toISOString();
  if (status === 'cancelled') invoice.cancelledAt = new Date().toISOString();

  invoices.set(invoiceId, invoice);
  return invoice;
}

export function sendPaymentReminder(invoiceId: string): InvoiceReminder | undefined {
  const invoice = invoices.get(invoiceId);
  if (!invoice) return undefined;
  if (invoice.status === 'paid' || invoice.status === 'cancelled') return undefined;
  if (!invoice.dueDate) return undefined;

  const daysOverdue = Math.floor(
    (Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  let reminderType: InvoiceReminder['type'];
  let message: string;

  if (daysOverdue <= 0) {
    const daysUntilDue = Math.abs(daysOverdue);
    if (daysUntilDue <= 7 && daysUntilDue > 3) {
      reminderType = '7_days';
      message = `Reminder: Invoice ${invoice.invoiceNumber} is due in ${daysUntilDue} days.`;
    } else if (daysUntilDue <= 3 && daysUntilDue > 0) {
      reminderType = '3_days';
      message = `Reminder: Invoice ${invoice.invoiceNumber} is due in ${daysUntilDue} days. Please arrange payment.`;
    } else {
      return undefined;
    }
  } else {
    reminderType = 'overdue';
    invoice.status = 'overdue';
    message = `Overdue Notice: Invoice ${invoice.invoiceNumber} is ${daysOverdue} day(s) overdue. Please pay immediately.`;
  }

  const reminder: InvoiceReminder = {
    sentAt: new Date().toISOString(),
    type: reminderType,
    message,
  };

  invoice.reminders.push(reminder);
  invoice.updatedAt = new Date().toISOString();
  invoices.set(invoiceId, invoice);

  if (invoice.recipientEmail) {
    emailService.send({
      to: invoice.recipientEmail,
      toName: invoice.recipientName,
      subject: `Payment Reminder: ${invoice.invoiceNumber}`,
      html: `<p>${message}</p><p>Total Due: $${invoice.total.toFixed(2)}</p>`,
    }).catch(() => {});
  }

  return reminder;
}

export function getOverdueInvoices(): InvoiceRecord[] {
  return [...invoices.values()].filter(
    (inv) => inv.status === 'sent' || inv.status === 'overdue'
  );
}

export function processOverdueInvoices(): InvoiceReminder[] {
  const sent = getOverdueInvoices();
  const reminders: InvoiceReminder[] = [];
  for (const inv of sent) {
    const reminder = sendPaymentReminder(inv.id);
    if (reminder) reminders.push(reminder);
  }
  return reminders;
}

export function getInvoiceReminders(invoiceId: string): InvoiceReminder[] {
  const invoice = invoices.get(invoiceId);
  return invoice?.reminders ?? [];
}

/**
 * Re-locks the FX rate for an existing multi-currency invoice — call this
 * when the invoice is actually paid, since the rate locked at generation
 * time may have expired or moved. Only updates the invoice's stored FX
 * fields; it does not touch payment processing/webhook handling.
 */
export async function reconvertInvoiceFxAtPayment(
  invoiceId: string,
  presentmentCurrency?: string,
): Promise<InvoiceRecord> {
  const invoice = invoices.get(invoiceId);
  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  const targetCurrency = (presentmentCurrency ?? invoice.presentmentCurrency)?.trim().toUpperCase();
  if (!targetCurrency) {
    throw new Error(`Invoice ${invoiceId} has no presentment currency to reconvert`);
  }
  if (targetCurrency === invoice.currency) {
    throw new Error(`presentmentCurrency must differ from settlement currency (${invoice.currency})`);
  }

  const lock = await lockFxForInvoice(invoice, targetCurrency);
  invoice.presentmentCurrency = lock.presentmentCurrency;
  invoice.presentmentAmount = lock.presentmentAmount;
  invoice.fxRate = lock.fxRate;
  invoice.fxRateLockedAt = lock.fxRateLockedAt;
  invoice.updatedAt = new Date().toISOString();

  invoices.set(invoice.id, invoice);
  return invoice;
}

export type MultiCurrencyReportRow = {
  currency: string;
  presentmentCurrency: string;
  invoiceCount: number;
  totalSettlement: number;
  totalPresentment: number;
  averageFxRate: number | null;
};

/**
 * Aggregates invoices by (currency, presentmentCurrency) pair — counts and
 * totals per pair — for multi-currency reporting. Single-currency invoices
 * (no presentmentCurrency set) are grouped under presentmentCurrency ===
 * currency with a null-equivalent fxRate of 1.
 */
export function generateMultiCurrencyReport(input: { merchantId?: string } = {}): {
  rows: MultiCurrencyReportRow[];
  totalInvoices: number;
  multiCurrencyInvoices: number;
} {
  const relevant = [...invoices.values()].filter(
    (invoice) => !input.merchantId || invoice.merchantId === input.merchantId,
  );

  const groups = new Map<
    string,
    { currency: string; presentmentCurrency: string; count: number; settlement: number; presentment: number; rateSum: number; rateCount: number }
  >();

  for (const invoice of relevant) {
    const presentmentCurrency = invoice.presentmentCurrency ?? invoice.currency;
    const key = `${invoice.currency}:${presentmentCurrency}`;
    const group = groups.get(key) ?? {
      currency: invoice.currency,
      presentmentCurrency,
      count: 0,
      settlement: 0,
      presentment: 0,
      rateSum: 0,
      rateCount: 0,
    };

    group.count += 1;
    group.settlement += invoice.total;
    group.presentment += invoice.presentmentAmount ?? invoice.total;
    if (invoice.fxRate !== null) {
      group.rateSum += invoice.fxRate;
      group.rateCount += 1;
    }

    groups.set(key, group);
  }

  const rows: MultiCurrencyReportRow[] = [...groups.values()].map((g) => ({
    currency: g.currency,
    presentmentCurrency: g.presentmentCurrency,
    invoiceCount: g.count,
    totalSettlement: Number(g.settlement.toFixed(2)),
    totalPresentment: Number(g.presentment.toFixed(2)),
    averageFxRate: g.rateCount > 0 ? Number((g.rateSum / g.rateCount).toFixed(10)) : null,
  }));

  return {
    rows: rows.sort((a, b) => a.currency.localeCompare(b.currency) || a.presentmentCurrency.localeCompare(b.presentmentCurrency)),
    totalInvoices: relevant.length,
    multiCurrencyInvoices: relevant.filter((i) => i.presentmentCurrency !== null).length,
  };
}

export function listInvoices(): InvoiceRecord[] {
  return [...invoices.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getInvoice(id: string): InvoiceRecord | undefined {
  return invoices.get(id);
}

export function getTaxRates(): Array<{ countryCode: string; rate: number }> {
  return Object.entries(TAX_RATES).map(([countryCode, rate]) => ({ countryCode, rate }));
}

export function generateTaxReport(input: { merchantId: string; from?: string; to?: string }) {
  const invoicesForMerchant = [...invoices.values()].filter((invoice) => invoice.merchantId === input.merchantId);
  const fromTime = input.from ? new Date(input.from).getTime() : 0;
  const toTime = input.to ? new Date(input.to).getTime() : Number.POSITIVE_INFINITY;

  const reportInvoices = invoicesForMerchant.filter((invoice) => {
    const createdAt = new Date(invoice.createdAt).getTime();
    return createdAt >= fromTime && createdAt <= toTime;
  });

  const totalTax = reportInvoices.reduce((sum, invoice) => sum + invoice.taxTotal, 0);
  const totalAmount = reportInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const csv = [
    'invoiceNumber,projectId,status,subtotal,taxTotal,total,currency,countryCode,createdAt',
    ...reportInvoices.map(
      (invoice) =>
        `${invoice.invoiceNumber},${invoice.projectId},${invoice.status},${invoice.subtotal},${invoice.taxTotal},${invoice.total},${invoice.currency},${invoice.countryCode},${invoice.createdAt}`
    ),
  ].join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<taxReport merchantId="${input.merchantId}">\n${reportInvoices
    .map(
      (invoice) =>
        `  <invoice>\n    <invoiceNumber>${invoice.invoiceNumber}</invoiceNumber>\n    <projectId>${invoice.projectId}</projectId>\n    <status>${invoice.status}</status>\n    <subtotal>${invoice.subtotal}</subtotal>\n    <taxTotal>${invoice.taxTotal}</taxTotal>\n    <total>${invoice.total}</total>\n    <currency>${invoice.currency}</currency>\n    <countryCode>${invoice.countryCode}</countryCode>\n    <createdAt>${invoice.createdAt}</createdAt>\n  </invoice>`
    )
    .join('\n')}\n</taxReport>`;

  return {
    merchantId: input.merchantId,
    from: input.from,
    to: input.to,
    totalTax: Number(totalTax.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
    invoices: reportInvoices,
    csv,
    xml,
  };
}

export function buildInvoicePdf(invoice: InvoiceRecord): Buffer {
  return buildSimplePdf(invoice);
}
