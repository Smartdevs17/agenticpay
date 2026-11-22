import { logger } from '../../utils/logger.js';
import type { InvoiceRecord } from '../invoice.js';
import { buildInvoiceViewModel } from './view-model.js';
import { defaultInvoiceTemplateRegistry, InvoiceTemplateRegistry } from './registry.js';
import {
  type InvoiceRenderer,
  type InvoiceViewModel,
  type InvoiceRenderResult,
  UnknownInvoiceTemplateError,
} from './types.js';

export * from './types.js';
export * from './view-model.js';
export * from './registry.js';
export * from './renderers/simple-renderer.js';
export * from './renderers/compact-renderer.js';

/**
 * High-level invoice PDF render function with observability (logs duration without sensitive content).
 */
export function renderInvoicePdf(
  invoice: InvoiceRecord,
  templateId?: string,
  registry: InvoiceTemplateRegistry = defaultInvoiceTemplateRegistry,
): Buffer {
  const start = Date.now();
  const selectedTemplate = templateId || 'default';
  try {
    const renderer = registry.get(selectedTemplate);
    const viewModel = buildInvoiceViewModel(invoice);
    const result = renderer.render(viewModel);
    const buffer = Buffer.isBuffer(result) ? result : (result as InvoiceRenderResult).data;
    const durationMs = Date.now() - start;

    logger.info('[InvoicePDF] Render completed', {
      invoiceNumber: invoice.invoiceNumber,
      templateId: selectedTemplate,
      bytes: buffer.byteLength,
      durationMs,
    });

    return buffer;
  } catch (error) {
    const durationMs = Date.now() - start;
    logger.error('[InvoicePDF] Render failed', {
      invoiceNumber: invoice.invoiceNumber,
      templateId: selectedTemplate,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
