export type ReportExportFormat = 'csv' | 'json' | 'excel';

export interface ReportExportResult {
  content: string;
  contentType: string;
  extension: 'csv' | 'json' | 'xls';
}

type ReportRow = Record<string, unknown>;

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function neutralizeSpreadsheetFormula(value: unknown): string {
  const text = stringifyCell(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeCsv(value: unknown): string {
  const text = neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeXml(value: unknown, neutralizeFormula = false): string {
  return (neutralizeFormula ? neutralizeSpreadsheetFormula(value) : stringifyCell(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnsFor(rows: ReportRow[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return [...columns];
}

/** Serialize report rows without evaluating formulas or emitting unsafe HTML. */
export function exportReportRows(rows: ReportRow[], format: ReportExportFormat): ReportExportResult {
  const columns = columnsFor(rows);

  if (format === 'json') {
    return {
      content: JSON.stringify(rows, null, 2),
      contentType: 'application/json; charset=utf-8',
      extension: 'json',
    };
  }

  if (format === 'csv') {
    const lines = [columns.map(escapeCsv).join(',')];
    for (const row of rows) lines.push(columns.map((column) => escapeCsv(row[column])).join(','));
    return {
      // UTF-8 BOM keeps non-ASCII data intact when opened directly in Excel.
      content: `\uFEFF${lines.join('\r\n')}`,
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv',
    };
  }

  const header = columns.map((column) => `<Cell><Data ss:Type="String">${escapeXml(column)}</Data></Cell>`).join('');
  const body = rows
    .map((row) => {
      const cells = columns.map((column) => {
        const value = row[column];
        const numeric = typeof value === 'number' && Number.isFinite(value);
        return `<Cell><Data ss:Type="${numeric ? 'Number' : 'String'}">${escapeXml(value, !numeric)}</Data></Cell>`;
      }).join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  return {
    content: `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table><Row>${header}</Row>${body}</Table></Worksheet></Workbook>`,
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    extension: 'xls',
  };
}
