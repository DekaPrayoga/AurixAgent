import type { Tool } from './Registry.js';

export const excelTool: Tool = {
  name: 'generate_excel',
  description: 'Generate an Excel workbook with data. Uses exceljs.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Output filename (e.g. report.xlsx)' },
      sheet_name: { type: 'string', description: 'Sheet name (default: Sheet1)' },
      headers: { type: 'string', description: 'Comma-separated column headers' },
      data: { type: 'string', description: 'JSON array of row objects' },
    },
    required: ['filename', 'headers'],
  },
  async execute(args) {
    const filename = args.filename as string;
    const sheetName = (args.sheet_name as string) || 'Sheet1';
    const headers = (args.headers as string).split(',').map(h => h.trim());
    let rows: Record<string, any>[] = [];
    try {
      rows = JSON.parse((args.data as string) || '[]');
    } catch {
      rows = [];
    }

    try {
      // @ts-expect-error optional dependency
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(sheetName);
      ws.columns = headers.map(h => ({ header: h, key: h }));
      for (const row of rows) ws.addRow(row);
      await wb.xlsx.writeFile(filename);
      return `Excel file created: ${filename} (${headers.length} columns, ${rows.length} rows)`;
    } catch (e: any) {
      return `Excel generation failed: ${e.message}\nInstall exceljs: npm install exceljs`;
    }
  },
};
