export interface InvoiceViewModelLineItem {
  description: string;
  hours: number;
  rate: number;
  amount: number;
  rateFormatted: string;
  amountFormatted: string;
  formattedLine: string;
}

export interface InvoiceViewModelTaxBreakdown {
  countryCode: string;
  rate: number;
  rateFormatted: string;
  amount: number;
  amountFormatted: string;
  currency: string;
  description: string;
}

export interface InvoiceViewModel {
  id: string;
  invoiceNumber: string;
  merchantId: string;
  projectId: string;
  generatedAt: string;
  currency: string;
  lineItems: InvoiceViewModelLineItem[];
  subtotal: number;
  subtotalFormatted: string;
  taxRatePercent: number;
  taxTotal: number;
  taxTotalFormatted: string;
  total: number;
  totalFormatted: string;
  summary: string;
  status: string;
  countryCode: string;
  taxBreakdown: InvoiceViewModelTaxBreakdown[];
}

export interface InvoiceRenderResult {
  data: Buffer;
  contentType: string;
}

export interface InvoiceRenderer {
  readonly id: string;
  readonly name: string;
  render(viewModel: InvoiceViewModel): Promise<InvoiceRenderResult> | InvoiceRenderResult;
}

export class UnknownInvoiceTemplateError extends Error {
  readonly templateId: string;

  constructor(templateId: string) {
    super(`Unknown invoice PDF template: "${templateId}"`);
    this.name = 'UnknownInvoiceTemplateError';
    this.templateId = templateId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
