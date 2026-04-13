import * as XLSX from 'xlsx';
import React from 'react';
import type { ParseResult } from './types';
import { COLORS } from './constants';
import { createRowStore } from './storage/rowStore';

/**
 * Calculate a percentage with one decimal place precision.
 */
export function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Format a number with locale-specific separators.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Normalize a site number string by stripping trailing ".0" decimals
 * and removing leading zeros. This handles values that Excel may have
 * stored as floats (e.g. "007.0" → "7") so that site numbers display
 * consistently and can be compared reliably.
 */
export function normalizeSiteNumber(s: string): string {
  const t = (s || '').trim().replace(/\.0+$/, '');
  const n = parseInt(t, 10);
  return isNaN(n) ? t : String(n);
}

/**
 * Convert a date value to ISO date string (YYYY-MM-DD).
 * Handles both ISO-format strings and Excel serial date numbers.
 * The magic number 25569 is the number of days between the Excel
 * epoch (1899-12-30) and the Unix epoch (1970-01-01).
 */
export function formatDate(v: string): string {
  if (!v) return '';
  if (/^\d{4}-\d{2}/.test(v)) return v.slice(0, 10);
  const n = parseFloat(v);
  if (!isNaN(n) && n > 1 && n < 200000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return v;
}

/**
 * Parse an Excel/CSV file buffer into row objects using a column-name mapping.
 * Returns rows, header diagnostics, and an optional error message.
 */
export function parseFile(buf: ArrayBuffer, map: Record<string, string>): ParseResult {
  try {
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const headerDiag: { raw: string; mapped: string; inMap: boolean; sample: string }[] = [];
    if (raw.length > 0) {
      for (const k of Object.keys(raw[0])) {
        const inMap = !!(map[k] || map[k.toLowerCase()]);
        const mk = map[k] || map[k.toLowerCase()] || k;
        const sv = raw[0][k];
        const svd = typeof sv === 'boolean' ? (sv ? 'TRUE' : 'FALSE') : String(sv ?? '').trim();
        const svn = (svd === 'true' || svd === 'false') ? svd.toUpperCase() : svd;
        headerDiag.push({ raw: k, mapped: mk, inMap, sample: svn.substring(0, 60) });
      }
    }
    const rows = raw.map((row: any) => {
      const m: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        const sv = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v ?? '').trim();
        m[map[k] || map[k.toLowerCase()] || k] = (sv === 'true' || sv === 'false') ? sv.toUpperCase() : sv;
      }
      return m;
    });
    return { rows, headerDiag };
  } catch (err: any) {
    return { rows: [], headerDiag: [], error: err.message };
  }
}

/**
 * Export data to an Excel file and trigger a download.
 */
export function exportToExcel(data: Record<string, string | number | boolean>[], filename: string): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Site Maturity');
  XLSX.writeFile(wb, filename);
}

/**
 * Stream referral rows from persistent browser storage to CSV.
 * Uses File System Access API when available, otherwise falls back
 * to a Blob-based download.
 */
export async function exportToCSVStream(storageKey: string, filename: string): Promise<void> {
  try {
    const store = await createRowStore();
    await store.open(storageKey);
    let headers: string[] | null = null;
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

    const picker = (window as any).showSaveFilePicker;
    if (picker) {
      const fh = await picker({ suggestedName: filename, types: [{ description: 'CSV Files', accept: { 'text/csv': ['.csv'] } }] });
      const ws = await fh.createWritable();
      for await (const batch of store.streamRead(10000)) {
        if (!batch.length) continue;
        if (!headers) {
          headers = Object.keys(batch[0]);
          await ws.write(headers.join(',') + '\n');
        }
        const lines = batch.map(row => headers!.map(h => esc(String(row[h] ?? ''))).join(',')).join('\n') + '\n';
        await ws.write(lines);
      }
      await ws.close();
      return;
    }

    const chunks: string[] = [];
    for await (const batch of store.streamRead(10000)) {
      if (!batch.length) continue;
      if (!headers) {
        headers = Object.keys(batch[0]);
        chunks.push(headers.join(',') + '\n');
      }
      chunks.push(batch.map(row => headers!.map(h => esc(String(row[h] ?? ''))).join(',')).join('\n') + '\n');
    }
    const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
    throw err;
  }
            }
      const lines = batch.map(row => headers!.map(h => esc(String(row[h] ?? ''))).join(',')).join('\n') + '\n';
      await ws.write(lines);
    }
    await ws.close();
    return;
  }

  const chunks: string[] = [];
  for await (const batch of store.streamRead(10000)) {
    if (!batch.length) continue;
    if (!headers) {
      headers = Object.keys(batch[0]);
      chunks.push(headers.join(',') + '\n');
    }
    chunks.push(batch.map(row => headers!.map(h => esc(String(row[h] ?? ''))).join(',')).join('\n') + '\n');
  }
  const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Return a sort-direction indicator character for a column header.
 * Shows ⇕ when the column is not the active sort field, or ↑/↓ for asc/desc.
 */
export function sortIcon(activeField: string, activeDirection: 'asc' | 'desc', field: string): string {
  if (field !== activeField) return ' ⇕';
  return activeDirection === 'asc' ? ' ↑' : ' ↓';
}

/**
 * Return inline styles for a sortable table header cell.
 * Highlights the background when the column is the active sort field.
 */
export function sortHeaderStyle(activeField: string, field: string, borderColor: string): React.CSSProperties {
  return {
    padding: '10px',
    textAlign: 'left',
    color: '#64748B',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    background: activeField === field ? borderColor + '44' : 'transparent',
    borderRadius: 4,
  };
}

/**
 * Return a color indicating the severity of a delta relative to
 * the RA clinical count. Green for small ratios, amber for moderate,
 * red for large discrepancies.
 */
export function deltaColor(delta: number, raClinCount: number): string {
  if (raClinCount === 0 && delta === 0) return COLORS.dimmed;
  const ratio = raClinCount > 0 ? Math.abs(delta) / raClinCount : Math.abs(delta) > 0 ? 1 : 0;
  if (ratio <= 0.2) return COLORS.green;
  if (ratio <= 0.5) return COLORS.amber;
  return COLORS.red;
}
