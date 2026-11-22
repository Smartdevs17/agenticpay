import {
  type InvoiceRenderer,
  UnknownInvoiceTemplateError,
} from './types.js';
import { SimpleInvoicePdfRenderer } from './renderers/simple-renderer.js';
import { CompactInvoicePdfRenderer } from './renderers/compact-renderer.js';

export class InvoiceTemplateRegistry {
  private readonly renderers = new Map<string, InvoiceRenderer>();
  private defaultTemplateId = 'default';

  constructor() {
    this.register(new SimpleInvoicePdfRenderer());
    this.register(new CompactInvoicePdfRenderer());
  }

  register(renderer: InvoiceRenderer): void {
    this.renderers.set(renderer.id.toLowerCase(), renderer);
  }

  setDefault(templateId: string): void {
    const key = templateId.toLowerCase();
    if (!this.renderers.has(key)) {
      throw new UnknownInvoiceTemplateError(templateId);
    }
    this.defaultTemplateId = key;
  }

  get(templateId?: string): InvoiceRenderer {
    const key = (templateId || this.defaultTemplateId).toLowerCase();
    const renderer = this.renderers.get(key);
    if (!renderer) {
      throw new UnknownInvoiceTemplateError(templateId || this.defaultTemplateId);
    }
    return renderer;
  }

  has(templateId: string): boolean {
    return this.renderers.has(templateId.toLowerCase());
  }

  list(): string[] {
    return Array.from(this.renderers.keys());
  }
}

export const defaultInvoiceTemplateRegistry = new InvoiceTemplateRegistry();
