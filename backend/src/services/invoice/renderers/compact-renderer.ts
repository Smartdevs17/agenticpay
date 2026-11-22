import type { InvoiceRenderer, InvoiceViewModel, InvoiceRenderResult } from '../types.js';

function escapePdfString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

export class CompactInvoicePdfRenderer implements InvoiceRenderer {
  readonly id = 'compact';
  readonly name = 'Compact Invoice PDF Renderer';

  render(viewModel: InvoiceViewModel): InvoiceRenderResult {
    const lines = [
      `*** AGENTICPAY INVOICE: ${viewModel.invoiceNumber} ***`,
      `Merchant: ${viewModel.merchantId} | Project: ${viewModel.projectId} | Date: ${viewModel.generatedAt}`,
      '------------------------------------------------------------',
      ...viewModel.lineItems.map((item, idx) => `${idx + 1}. ${item.formattedLine}`),
      '------------------------------------------------------------',
      `SUBTOTAL: ${viewModel.subtotalFormatted}`,
      `TAX (${viewModel.taxRatePercent}%): ${viewModel.taxTotalFormatted}`,
      `TOTAL AMOUNT: ${viewModel.totalFormatted}`,
      '------------------------------------------------------------',
      `Notes: ${viewModel.summary}`,
    ];

    const escapedLines = lines.map((line) => `(${escapePdfString(line)}) Tj T*`).join('\n');
    const content = `BT /F1 10 Tf 30 750 Td\n${escapedLines}\nET`;
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

    const data = Buffer.from(header + objects.join('') + xref + trailer, 'latin1');
    return {
      data,
      contentType: 'application/pdf',
    };
  }
}
