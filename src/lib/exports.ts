/**
 * Exporting data to CSV / Excel.
 *
 * SAFETY NOTE - spreadsheet formula injection:
 * If a BDM types `=HYPERLINK("http://evil.site","Click")` into a remarks box and
 * we write it straight into a CSV, Excel treats it as a FORMULA when the file is
 * opened and may run it. Every text value below is therefore prefixed with an
 * apostrophe if it starts with = + - @ tab or carriage return, which makes Excel
 * treat it as plain text. This is why exports go through this file and are never
 * hand-rolled elsewhere.
 */

import * as XLSX from 'xlsx';

export type CellValue = string | number | null | undefined;
export type ExportRow = Record<string, CellValue>;

const FORMULA_START = /^[=+\-@\t\r]/;

function neutralise(value: CellValue): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;

  const text = String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function csvCell(value: CellValue): string {
  const safe = neutralise(value);
  if (typeof safe === 'number') return String(safe);
  return `"${safe.replace(/"/g, '""')}"`;
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads rows as a CSV that Excel opens correctly, including Indian names. */
export function downloadCsv(rows: ExportRow[], baseName: string): void {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]!);
  const lines = [headers.map(csvCell).join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(','));
  }

  // The byte-order mark is what makes Excel read this as UTF-8 rather than
  // mangling accented characters.
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });

  triggerDownload(blob, `${baseName}-${timestamp()}.csv`);
}

/** Downloads rows as a real .xlsx workbook. */
export function downloadExcel(rows: ExportRow[], baseName: string, sheetName = 'Data'): void {
  if (rows.length === 0) return;

  const safeRows = rows.map((row) => {
    const clean: ExportRow = {};
    for (const [key, value] of Object.entries(row)) clean[key] = neutralise(value);
    return clean;
  });

  const sheet = XLSX.utils.json_to_sheet(safeRows);

  // Roughly size the columns to their content so nothing arrives as ####.
  const headers = Object.keys(rows[0]!);
  sheet['!cols'] = headers.map((header) => {
    const longest = safeRows.reduce(
      (max, row) => Math.max(max, String(row[header] ?? '').length),
      header.length,
    );
    return { wch: Math.min(48, Math.max(10, longest + 2)) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${baseName}-${timestamp()}.xlsx`,
  );
}
