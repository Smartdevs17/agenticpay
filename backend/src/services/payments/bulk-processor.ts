import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

interface ParsedRow {
  amount: number;
  destination: string;
  currency?: string;
  memo?: string;
  chain?: string;
}

interface ColumnMapping {
  amount: string;
  destination: string;
  currency?: string;
  memo?: string;
  chain?: string;
}

interface ValidationResult {
  rowNumber: number;
  status: 'valid' | 'invalid';
  errors: string[];
  warnings: string[];
  parsed?: ParsedRow;
}

export class BulkProcessorService {
  async parseAndValidate(
    rawData: any[],
    columnMapping: ColumnMapping,
    tenantId: string,
  ): Promise<{ rows: ValidationResult[]; validCount: number; errorCount: number }> {
    const results: ValidationResult[] = [];
    let validCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 1;
      const errors: string[] = [];
      const warnings: string[] = [];

      const amountRaw = row[columnMapping.amount];
      const amount = parseFloat(amountRaw);
      if (!amountRaw || isNaN(amount) || amount <= 0) {
        errors.push('Invalid or missing amount');
      } else if (amount > 100000000) {
        warnings.push('Amount exceeds 100M, verify correctness');
      }

      const destination = String(row[columnMapping.destination] || '').trim();
      if (!destination) {
        errors.push('Missing destination address');
      } else if (destination.length < 10) {
        errors.push('Destination address appears too short');
      } else if (destination.length > 100) {
        errors.push('Destination address exceeds maximum length');
      }

      const currency = columnMapping.currency
        ? String(row[columnMapping.currency] || '').trim().toUpperCase() || 'XLM'
        : 'XLM';
      const memo = columnMapping.memo
        ? String(row[columnMapping.memo] || '').trim()
        : undefined;
      const chain = columnMapping.chain
        ? String(row[columnMapping.chain] || '').trim().toLowerCase() || 'stellar'
        : 'stellar';

      const parsed: ParsedRow = { amount, destination, currency, memo, chain };

      results.push({
        rowNumber: rowNum,
        status: errors.length > 0 ? 'invalid' : 'valid',
        errors,
        warnings,
        parsed: errors.length === 0 ? parsed : undefined,
      });

      if (errors.length > 0) errorCount++;
      else validCount++;
    }

    return { rows: results, validCount, errorCount };
  }

  async createBulkUpload(
    tenantId: string,
    userId: string | undefined,
    fileName: string,
    fileSize: number,
    mimeType: string,
    columnMapping: ColumnMapping,
    validationResults: ValidationResult[],
  ) {
    const validRows = validationResults.filter(r => r.status === 'valid');
    const errorRows = validationResults.filter(r => r.status === 'invalid');

    const bulk = await prisma.bulkUpload.create({
      data: {
        tenantId,
        userId,
        fileName,
        fileSize,
        mimeType,
        totalRows: validationResults.length,
        validRows: validRows.length,
        errorRows: errorRows.length,
        columnMapping,
        status: 'pending',
      },
    });

    await prisma.bulkUploadRow.createMany({
      data: validationResults.map(r => ({
        bulkUploadId: bulk.id,
        rowNumber: r.rowNumber,
        rawData: r.parsed ? { amount: r.parsed.amount, destination: r.parsed.destination, currency: r.parsed.currency, memo: r.parsed.memo, chain: r.parsed.chain } : null,
        parsedData: r.parsed || null,
        status: r.status === 'valid' ? 'valid' : 'invalid',
        errors: r.errors.length > 0 ? r.errors : undefined,
        warnings: r.warnings.length > 0 ? r.warnings : undefined,
      })),
    });

    return bulk;
  }

  async processBulkUpload(bulkUploadId: string, tenantId: string) {
    const bulk = await prisma.bulkUpload.findFirst({
      where: { id: bulkUploadId, tenantId, deletedAt: null },
      include: { rows: { where: { status: 'valid' }, orderBy: { rowNumber: 'asc' } } },
    });

    if (!bulk) throw new AppError(404, 'Bulk upload not found', 'NOT_FOUND');

    await prisma.bulkUpload.update({
      where: { id: bulkUploadId },
      data: { status: 'processing' },
    });

    let processedCount = 0;
    let failedCount = 0;
    const batchSize = 50;
    const validRows = bulk.rows;
    const totalBatches = Math.ceil(validRows.length / batchSize);

    for (let batch = 0; batch < totalBatches; batch++) {
      const batchRows = validRows.slice(batch * batchSize, (batch + 1) * batchSize);

      await Promise.allSettled(
        batchRows.map(async (row) => {
          try {
            const data = row.parsedData as any;
            if (!data) return;

            const payment = await prisma.payment.create({
              data: {
                tenantId,
                amount: data.amount,
                currency: data.currency || 'XLM',
                network: data.chain || 'stellar',
                status: 'pending',
                toAddress: data.destination,
                memo: data.memo,
                metadata: { bulkUploadId, sourceRow: row.rowNumber },
              },
            });

            await prisma.bulkUploadRow.update({
              where: { id: row.id },
              data: {
                status: 'completed',
                paymentId: payment.id,
                processedAt: new Date(),
              },
            });
            processedCount++;
          } catch (err: any) {
            await prisma.bulkUploadRow.update({
              where: { id: row.id },
              data: {
                status: 'failed',
                errors: [err.message || 'Processing failed'],
              },
            });
            failedCount++;
          }
        }),
      );
    }

    const finalStatus =
      failedCount === 0 ? 'completed'
      : processedCount > 0 ? 'partially_completed'
      : 'failed';

    await prisma.bulkUpload.update({
      where: { id: bulkUploadId },
      data: {
        status: finalStatus,
        processedRows: processedCount,
        failedRows: failedCount,
        completedAt: new Date(),
      },
    });

    return { processedCount, failedCount, totalBatches, status: finalStatus };
  }

  async getBulkUpload(bulkUploadId: string, tenantId: string) {
    const bulk = await prisma.bulkUpload.findFirst({
      where: { id: bulkUploadId, tenantId, deletedAt: null },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!bulk) throw new AppError(404, 'Bulk upload not found', 'NOT_FOUND');
    return bulk;
  }

  async listBulkUploads(tenantId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.bulkUpload.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.bulkUpload.count({ where: { tenantId, deletedAt: null } }),
    ]);
    return { items, total, page, limit };
  }

  async generateErrorReport(bulkUploadId: string, tenantId: string): Promise<string> {
    const bulk = await prisma.bulkUpload.findFirst({
      where: { id: bulkUploadId, tenantId, deletedAt: null },
      include: { rows: { where: { status: { in: ['invalid', 'failed'] } }, orderBy: { rowNumber: 'asc' } } },
    });

    if (!bulk) throw new AppError(404, 'Bulk upload not found', 'NOT_FOUND');

    const escapeCsv = (val: string) => {
      if (!val) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = 'Row Number,Status,Errors,Warnings,Suggestion\n';
    const rows = bulk.rows.map(r => {
      const errors = Array.isArray(r.errors) ? r.errors.join('; ') : '';
      const warnings = Array.isArray(r.warnings) ? r.warnings.join('; ') : '';
      const suggestion = errors.includes('Invalid or missing amount') ? 'Check the amount column has a valid positive number' :
        errors.includes('Missing destination') ? 'Ensure destination address is provided' : 'Review the row data';
      return `${r.rowNumber},${escapeCsv(r.status)},${escapeCsv(errors)},${escapeCsv(warnings)},${escapeCsv(suggestion)}`;
    }).join('\n');

    return header + rows;
  }
}

export const bulkProcessorService = new BulkProcessorService();
