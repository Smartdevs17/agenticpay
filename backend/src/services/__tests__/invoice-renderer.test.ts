import { describe, it, expect } from 'vitest';
import {
  buildInvoicePdf,
  type InvoiceRecord,
  UnknownInvoiceTemplateError,
  InvoiceTemplateRegistry,
  type InvoiceRenderer,
  type InvoiceViewModel,
  renderInvoicePdf,
} from '../invoice.js';
import { buildInvoiceViewModel } from '../invoice/view-model.js';

/**
 * Extracts and normalises textual lines from a generated PDF stream Buffer.
 * This ignores byte offsets and xref tables (which vary with length) and strips
 * variable identifiers/timestamps so semantic layout and content can be verified deterministically.
 */
function extractNormalisedPdfLines(pdfBuffer: Buffer): string[] {
  const content = pdfBuffer.toString('latin1');
  const streamMatch = content.match(/stream\s*\n([\s\S]*?)\nendstream/);
  if (!streamMatch) return [];

  const streamContent = streamMatch[1];
  const lineMatches = streamContent.matchAll(/\((.*?)\)\s*Tj/g);
  return Array.from(lineMatches, (m) => m[1]);
}

const fixtureInvoices: Record<string, InvoiceRecord> = {
  standardUsd: {
    id: 'inv_usd_001',
    invoiceNumber: 'INV-TEST-0001',
    merchantId: 'MERCHANT_US',
    projectId: 'PROJ_ALPHA',
    generatedAt: '2026-11-22T10:00:00.000Z',
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    currency: 'USD',
    status: 'pending',
    countryCode: 'US',
    summary: 'Standard consulting service invoice',
    lineItems: [
      {
        description: 'Backend architecture redesign',
        hours: 10,
        rate: 150,
        amount: 1500,
        taxAmount: 150,
        totalAmount: 1650,
      },
      {
        description: 'Code review and unit tests',
        hours: 5,
        rate: 100,
        amount: 500,
        taxAmount: 50,
        totalAmount: 550,
      },
    ],
    subtotal: 2000,
    taxTotal: 200,
    total: 2200,
    taxBreakdown: [
      {
        countryCode: 'US',
        rate: 10,
        amount: 200,
        currency: 'USD',
        description: 'US State Tax',
      },
    ],
  },

  multiCurrencyEur: {
    id: 'inv_eur_002',
    invoiceNumber: 'INV-TEST-0002',
    merchantId: 'MERCHANT_EU',
    projectId: 'PROJ_BETA',
    generatedAt: '2026-11-22T10:00:00.000Z',
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    currency: 'EUR',
    status: 'paid',
    countryCode: 'DE',
    summary: 'Cloud hosting & migration services',
    lineItems: [
      {
        description: 'Kubernetes cluster deployment',
        hours: 20,
        rate: 120,
        amount: 2400,
        taxAmount: 456,
        totalAmount: 2856,
      },
    ],
    subtotal: 2400,
    taxTotal: 456,
    total: 2856,
    taxBreakdown: [
      {
        countryCode: 'DE',
        rate: 19,
        amount: 456,
        currency: 'EUR',
        description: 'DE VAT',
      },
    ],
  },

  zeroAndLargeAmounts: {
    id: 'inv_large_003',
    invoiceNumber: 'INV-TEST-0003',
    merchantId: 'MERCHANT_CORP',
    projectId: 'PROJ_GAMMA',
    generatedAt: '2026-11-22T10:00:00.000Z',
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    currency: 'GBP',
    status: 'draft',
    countryCode: 'GB',
    summary: 'Enterprise SLA & pro-bono onboarding',
    lineItems: [
      {
        description: 'Initial consultation (pro-bono)',
        hours: 4,
        rate: 0,
        amount: 0,
        taxAmount: 0,
        totalAmount: 0,
      },
      {
        description: 'Annual enterprise license',
        hours: 1,
        rate: 1000000,
        amount: 1000000,
        taxAmount: 200000,
        totalAmount: 1200000,
      },
    ],
    subtotal: 1000000,
    taxTotal: 200000,
    total: 1200000,
    taxBreakdown: [
      {
        countryCode: 'GB',
        rate: 20,
        amount: 200000,
        currency: 'GBP',
        description: 'UK VAT',
      },
    ],
  },

  hostileUnicodeAndLongText: {
    id: 'inv_hostile_004',
    invoiceNumber: 'INV-TEST-0004',
    merchantId: 'MERCHANT_SECURITY',
    projectId: 'PROJ_DELTA',
    generatedAt: '2026-11-22T10:00:00.000Z',
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    currency: 'JPY',
    status: 'pending',
    countryCode: 'JP',
    summary: '<script>alert("xss")</script> & special chars: € £ ¥ 🚀 and ' + 'A'.repeat(200),
    lineItems: [
      {
        description: '<b>Penetration testing & audit</b> \r\n (malicious formatting)',
        hours: 8,
        rate: 50000,
        amount: 400000,
        taxAmount: 40000,
        totalAmount: 440000,
      },
    ],
    subtotal: 400000,
    taxTotal: 40000,
    total: 440000,
    taxBreakdown: [
      {
        countryCode: 'JP',
        rate: 10,
        amount: 40000,
        currency: 'JPY',
        description: 'Japan Consumption Tax',
      },
    ],
  },
};

describe('Invoice PDF Renderer and Pluggable Template Registry (Issue #1412)', () => {
  it('renders standard PDF output matching pre-refactor recording for USD invoice', () => {
    const pdf = buildInvoicePdf(fixtureInvoices.standardUsd);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 8).toString('latin1')).toContain('%PDF-1.4');

    const lines = extractNormalisedPdfLines(pdf);
    expect(lines).toContain('Invoice: INV-TEST-0001');
    expect(lines).toContain('Merchant: MERCHANT_US');
    expect(lines).toContain('Currency: USD');
    expect(lines).toContain('Backend architecture redesign — 10h @ 150.00 = 1500.00 USD');
    expect(lines).toContain('Subtotal: 2000.00 USD');
    expect(lines).toContain('Tax (10%): 200.00 USD');
    expect(lines).toContain('Total: 2200.00 USD');
  });

  it('renders multi-currency EUR invoice with VAT breakdown', () => {
    const pdf = buildInvoicePdf(fixtureInvoices.multiCurrencyEur);
    const lines = extractNormalisedPdfLines(pdf);
    expect(lines).toContain('Currency: EUR');
    expect(lines).toContain('Kubernetes cluster deployment — 20h @ 120.00 = 2400.00 EUR');
    expect(lines).toContain('Total: 2856.00 EUR');
  });

  it('renders zero and large amounts with consistent 2-decimal formatting', () => {
    const pdf = buildInvoicePdf(fixtureInvoices.zeroAndLargeAmounts);
    const lines = extractNormalisedPdfLines(pdf);
    expect(lines).toContain('Initial consultation \\(pro-bono\\) — 4h @ 0.00 = 0.00 GBP');
    expect(lines).toContain('Annual enterprise license — 1h @ 1000000.00 = 1000000.00 GBP');
    expect(lines).toContain('Total: 1200000.00 GBP');
  });

  it('renders compact template when specified in template registry', () => {
    const pdf = buildInvoicePdf(fixtureInvoices.standardUsd, 'compact');
    expect(pdf.subarray(0, 8).toString('latin1')).toContain('%PDF-1.4');
    const lines = extractNormalisedPdfLines(pdf);
    expect(lines[0]).toContain('*** AGENTICPAY INVOICE: INV-TEST-0001 ***');
  });

  it('safely escapes hostile markup, script tags, long text, and parenthesis', () => {
    const pdf = buildInvoicePdf(fixtureInvoices.hostileUnicodeAndLongText);
    const content = pdf.toString('latin1');
    // Escaped parenthesis in PDF format
    expect(content).toContain('\\(malicious formatting\\)');
    // Script tag is treated strictly as plain text, no template execution
    expect(content).toContain('<script>alert');
  });

  it('throws UnknownInvoiceTemplateError clearly on unknown template id', () => {
    expect(() => buildInvoicePdf(fixtureInvoices.standardUsd, 'non_existent_template')).toThrow(
      UnknownInvoiceTemplateError,
    );
    expect(() => buildInvoicePdf(fixtureInvoices.standardUsd, 'non_existent_template')).toThrow(
      'Unknown invoice PDF template: "non_existent_template"',
    );
  });

  it('allows custom renderer to satisfy the InvoiceRenderer interface', () => {
    const customRegistry = new InvoiceTemplateRegistry();
    const mockFakeRenderer: InvoiceRenderer = {
      id: 'custom-fake',
      name: 'Mock Fake Invoice Renderer',
      render: (vm: InvoiceViewModel) => ({
        data: Buffer.from(`RAW_FAKE_DATA_${vm.invoiceNumber}`, 'utf8'),
        contentType: 'application/octet-stream',
      }),
    };

    customRegistry.register(mockFakeRenderer);
    expect(customRegistry.has('custom-fake')).toBe(true);

    const resultBuffer = renderInvoicePdf(fixtureInvoices.standardUsd, 'custom-fake', customRegistry);
    expect(resultBuffer.toString('utf8')).toBe('RAW_FAKE_DATA_INV-TEST-0001');
  });
});
