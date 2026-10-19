import { describe, expect, it } from 'vitest';
import { exportReportRows } from './report-export.js';

const rows = [
  { merchant: 'Alice, Inc.', payments: 2, note: 'quoted "value"' },
  { merchant: 'Björk & Co', payments: 1, note: '=HYPERLINK("https://example.com")' },
];

describe('exportReportRows', () => {
  it('exports valid JSON', () => {
    const result = exportReportRows(rows, 'json');
    expect(result.extension).toBe('json');
    expect(JSON.parse(result.content)).toEqual(rows);
  });

  it('exports RFC-compatible CSV with an Excel UTF-8 BOM', () => {
    const result = exportReportRows(rows, 'csv');
    expect(result.contentType).toContain('text/csv');
    expect(result.content.startsWith('\uFEFFmerchant,payments,note')).toBe(true);
    expect(result.content).toContain('"Alice, Inc."');
    expect(result.content).toContain('"quoted ""value"""');
    expect(result.content).toContain("'=HYPERLINK");
  });

  it('exports an Excel-readable SpreadsheetML workbook with escaped cells', () => {
    const result = exportReportRows(rows, 'excel');
    expect(result.extension).toBe('xls');
    expect(result.contentType).toContain('application/vnd.ms-excel');
    expect(result.content).toContain('ss:Type="Number">2</Data>');
    expect(result.content).toContain('Björk &amp; Co');
    expect(result.content).toContain('&apos;=HYPERLINK');
  });
});
