import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';

let openaiClient: OpenAI | null = null;

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

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'overdue';

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
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  status: InvoiceStatus;
  countryCode: string;
  taxBreakdown: InvoiceTaxBreakdown[];
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
    status: 'pending',
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
  };

  invoices.set(invoice.id, invoice);
  return invoice;
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
