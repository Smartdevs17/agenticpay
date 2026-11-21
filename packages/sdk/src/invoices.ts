import { AgenticPayClient } from './client.js';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export type Invoice = {
  id: string;
  projectId: string;
  merchantId: string;
  freelancerId: string;
  workDescription: string;
  hoursWorked?: number;
  hourlyRate?: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  status: InvoiceStatus;
  dueDate?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type GenerateInvoiceInput = {
  projectId: string;
  merchantId: string;
  workDescription: string;
  hoursWorked?: number;
  hourlyRate?: number;
  countryCode?: string;
};

export class InvoicesApi {
  constructor(private readonly client: AgenticPayClient) {}

  /** Generate an AI-powered invoice for completed work. */
  generate(input: GenerateInvoiceInput) {
    return this.client.post<Invoice>('/invoice/generate', input);
  }

  /** Get invoice by ID. */
  get(id: string) {
    return this.client.get<Invoice>(`/invoice/${id}`);
  }

  /** List invoices for a merchant. */
  listForMerchant(merchantId: string, params?: { status?: InvoiceStatus; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.client.get<Invoice[]>(`/invoice/merchant/${merchantId}${suffix}`);
  }

  /** List invoices for a project. */
  listForProject(projectId: string) {
    return this.client.get<Invoice[]>(`/invoice/project/${projectId}`);
  }
}
