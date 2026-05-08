/// <reference lib="webworker" />
import * as XLSX from 'xlsx';
import type { HeaderDiag, ReferralAnalytics } from '@/types';
import { DuckDbRowStore } from '@/storage/duckdbRowStore';
import { getConn } from '@/storage/duckdbEngine';
import { ReferralAnalyticsAccumulator } from '@/lib/referralAnalyticsAccumulator';
import { formatDate } from '@/utils';

type Ctx = {
  sites: Record<string, string>[] | null;
  listings: Record<string, string>[] | null;
  users: Record<string, string>[] | null;
};

type WorkerRequest =
  | { type: 'parse-small'; requestId: number; buffer: ArrayBuffer; map: Record<string, string>; fileName: string; fileSize: number; storageKey: string; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null; ingestRoute: 'auto' | 'small' | 'large' }
  | { type: 'parse-csv-stream'; requestId: number; file: File; map: Record<string, string>; storageKey: string; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null; ingestRoute: 'auto' | 'small' | 'large' }
  | { type: 'filter-from-store'; requestId: number; storageKey: string; includeTest: boolean; regionRefs?: string[]; initialTargetRefs?: string[]; raNames?: string[]; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null }
  | { type: 'parse-tabular'; requestId: number; buffer: ArrayBuffer; map: Record<string, string> };

type ProgressMessage = {
  type: 'progress';
  requestId: number;
  processed: number;
  total: number;
  pct: number;
  stage: string;
};

const normalize = (v: unknown): string => {
  const sv = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v ?? '').trim();
  return sv === 'true' || sv === 'false' ? sv.toUpperCase() : sv;
};

const mapHeader = (header: string, map: Record<string, string>): string => map[header] || map[header.toLowerCase()] || header;

const postProgress = (requestId: number, processed: number, total: number, stage: string) => {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 1000) / 10) : 0;
  const message: ProgressMessage = { type: 'progress', requestId, processed, total, pct, stage };
  self.postMessage(message);
};

const rowStore = new DuckDbRowStore();
let cachedStorageKey = '';
let baseAnalytics: ReferralAnalytics | null = null;

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const noFilters = (includeTest: boolean, regionRefs: string[], initialTargetRefs: string[] | undefined, raNames: string[] | undefined) =>
  includeTest && regionRefs.length === 0 && (!initialTargetRefs || !initialTargetRefs.length) && (!raNames || !raNames.length);

const processCsvStreaming = async (
  requestId: number,
  file: File,
  map: Record<string, string>,
  storageKey: string,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
  ingestRoute: 'auto' | 'small' | 'large',
) => {
  postProgress(requestId, 0, file.size, 'Ingesting CSV into DuckDB...');
  await rowStore.open(storageKey);
  await rowStore.clear(storageKey);
  cachedStorageKey = storageKey;
  baseAnalytics = null;

  await rowStore.ingestCsvFile(file, map);
  postProgress(requestId, Math.floor(file.size * 0.6), file.size, 'Normalizing data...');

  const table = rowStore.getTableName();
  const columns = rowStore.getColumns();
  const conn = await getConn();

  if (columns.includes('referralCreationDate')) {
    await conn.query(
      `UPDATE ${ident(table)} SET ${ident('referralCreationDate')} = COALESCE(TRY_STRFTIME(TRY_CAST(${ident('referralCreationDate')} AS TIMESTAMP), '%Y-%m-%d'), ${ident('referralCreationDate')})`
    );
  }

  const required = ['referralCreationDate', 'referralRef', 'referralTargetRef'].filter(k => columns.includes(k));
  let missingRequiredRows = 0;
  let invalidDateRows = 0;

  if (required.length) {
    const missingClause = required.map(k => `(${ident(k)} IS NULL OR ${ident(k)} = '')`).join(' OR ');
    const res = await conn.query(`SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)} WHERE ${missingClause}`);
    missingRequiredRows = Number((res.toArray()[0] as { toJSON: () => { n: number } }).toJSON().n || 0);
    if (missingRequiredRows > 0) {
      await conn.query(`DELETE FROM ${ident(table)} WHERE ${missingClause}`);
    }
  }

  if (columns.includes('referralCreationDate')) {
    const res = await conn.query(
      `SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)} WHERE NOT regexp_matches(${ident('referralCreationDate')}, '^\\d{4}-\\d{2}-\\d{2}$')`
    );
    invalidDateRows = Number((res.toArray()[0] as { toJSON: () => { n: number } }).toJSON().n || 0);
  }

  const cntRes = await conn.query(`SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)}`);
  const acceptedRows = Number((cntRes.toArray()[0] as { toJSON: () => { n: number } }).toJSON().n || 0);
  (rowStore as unknown as { rowCount: number }).rowCount = acceptedRows;

  postProgress(requestId, Math.floor(file.size * 0.8), file.size, 'Computing analytics...');
  const acc = new ReferralAnalyticsAccumulator({ sites, listings, users });
  for await (const batch of rowStore.streamRead(50000)) {
    for (const row of batch) acc.add(row);
  }
  const analytics = acc.finalize();
  baseAnalytics = analytics;

  const sampleRes = await conn.query(`SELECT * FROM ${ident(table)} LIMIT 1`);
  const sampleRow = sampleRes.toArray()[0] as { toJSON: () => Record<string, unknown> } | undefined;
  const sample = sampleRow ? sampleRow.toJSON() : {};
  const headerDiag: HeaderDiag[] = columns.map(c => ({
    raw: c,
    mapped: c,
    inMap: true,
    sample: normalize(sample[c]).slice(0, 60),
  }));

  postProgress(requestId, file.size, file.size, 'Completed');
  self.postMessage({
    type: 'complete',
    requestId,
    headerDiag,
    analytics,
    metadata: {
      parser: 'csv-stream',
      ingestRoute,
      rowCount: acceptedRows,
      fileName: file.name,
      fileSize: file.size,
      storageEngine: 'opfs',
      storageKey,
      diagnostics: {
        sourceRows: acceptedRows + missingRequiredRows,
        acceptedRows,
        omittedRows: missingRequiredRows,
        mismatchedRows: 0,
        missingRequiredRows,
        invalidDateRows,
        omittedSamples: [],
      },
      paritySignature: `${analytics.total}|${analytics.distinctRefs}|${analytics.timeline.length}|${analytics.weekly.length}`,
    },
  });
};

const processXlsxSmall = async (
  requestId: number,
  buffer: ArrayBuffer,
  map: Record<string, string>,
  fileName: string,
  fileSize: number,
  storageKey: string,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
  ingestRoute: 'auto' | 'small' | 'large',
) => {
  await rowStore.open(storageKey);
  await rowStore.clear(storageKey);
  cachedStorageKey = storageKey;
  baseAnalytics = null;

  postProgress(requestId, 0, 100, 'Reading workbook...');
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  postProgress(requestId, 35, 100, 'Converting sheet to rows...');
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headerDiag: HeaderDiag[] = [];
  if (raw.length > 0) {
    for (const k of Object.keys(raw[0])) {
      headerDiag.push({
        raw: k,
        mapped: mapHeader(k, map),
        inMap: !!(map[k] || map[k.toLowerCase()]),
        sample: normalize(raw[0][k]).slice(0, 60),
      });
    }
  }
  postProgress(requestId, 55, 100, 'Mapping fields...');
  const mapped: Record<string, string>[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const src = raw[i];
    const out: Record<string, string> = {};
    for (const k in src) out[mapHeader(k, map)] = normalize(src[k]);
    if (out.referralCreationDate) out.referralCreationDate = formatDate(out.referralCreationDate) || out.referralCreationDate;
    mapped[i] = out;
  }

  postProgress(requestId, 75, 100, 'Storing rows in DuckDB...');
  await rowStore.createFromRows(mapped);

  postProgress(requestId, 90, 100, 'Computing analytics...');
  const acc = new ReferralAnalyticsAccumulator({ sites, listings, users });
  for (const row of mapped) acc.add(row);
  const analytics = acc.finalize();
  baseAnalytics = analytics;

  postProgress(requestId, 100, 100, 'Completed');
  self.postMessage({
    type: 'complete',
    requestId,
    headerDiag,
    analytics,
    metadata: {
      parser: 'xlsx-worker',
      ingestRoute,
      rowCount: rowStore.getRowCount(),
      fileName,
      fileSize,
      storageEngine: 'opfs',
      storageKey,
      diagnostics: {
        sourceRows: raw.length,
        acceptedRows: rowStore.getRowCount(),
        omittedRows: 0,
        mismatchedRows: 0,
        missingRequiredRows: 0,
        invalidDateRows: 0,
      },
    },
  });
};

const filterFromStore = async (
  requestId: number,
  storageKey: string,
  includeTest: boolean,
  regionRefs: string[] = [],
  initialTargetRefs: string[] | undefined,
  raNames: string[] | undefined,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
) => {
  const ctx: Ctx = { sites, listings, users };
  const noFilter = noFilters(includeTest, regionRefs, initialTargetRefs, raNames);

  if (noFilter && baseAnalytics && cachedStorageKey === storageKey) {
    self.postMessage({ type: 'filtered', requestId, analytics: baseAnalytics });
    return;
  }

  await rowStore.open(storageKey);
  cachedStorageKey = storageKey;

  const columns = new Set(rowStore.getColumns());
  const clauses: string[] = [];

  if (!includeTest && columns.has('sentToTestListing')) {
    clauses.push(`(${ident('sentToTestListing')} IS NULL OR ${ident('sentToTestListing')} <> 'TRUE')`);
  }
  if (regionRefs.length && columns.has('referralTargetRef')) {
    const list = regionRefs.map(sqlLit).join(',');
    clauses.push(`${ident('referralTargetRef')} IN (${list})`);
  }
  if (initialTargetRefs?.length && columns.has('initialReferralTargetRef')) {
    const list = initialTargetRefs.map(sqlLit).join(',');
    clauses.push(`${ident('initialReferralTargetRef')} IN (${list})`);
  }
  if (raNames?.length && columns.has('raName')) {
    const list = raNames.map(sqlLit).join(',');
    clauses.push(`${ident('raName')} IN (${list})`);
  }

  const whereClause = clauses.join(' AND ');
  const acc = new ReferralAnalyticsAccumulator(ctx);
  const iterator = await rowStore.streamReadFiltered(50000, whereClause);
  for await (const batch of iterator) {
    for (const row of batch) acc.add(row);
  }
  const analytics = acc.finalize();
  if (noFilter) baseAnalytics = analytics;
  self.postMessage({ type: 'filtered', requestId, analytics });
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'parse-tabular') {
      const wb = XLSX.read(msg.buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const headerDiag: HeaderDiag[] = [];
      if (raw.length > 0) {
        for (const k of Object.keys(raw[0])) {
          headerDiag.push({
            raw: k,
            mapped: mapHeader(k, msg.map),
            inMap: !!(msg.map[k] || msg.map[k.toLowerCase()]),
            sample: normalize(raw[0][k]).slice(0, 60),
          });
        }
      }
      const rows: Record<string, string>[] = new Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        const src = raw[i];
        const out: Record<string, string> = {};
        for (const k in src) out[mapHeader(k, msg.map)] = normalize(src[k]);
        rows[i] = out;
      }
      self.postMessage({ type: 'tabular-complete', requestId: msg.requestId, rows, headerDiag });
      return;
    }
    if (msg.type === 'parse-small') {
      await processXlsxSmall(msg.requestId, msg.buffer, msg.map, msg.fileName, msg.fileSize, msg.storageKey, msg.sites, msg.listings, msg.users, msg.ingestRoute);
      return;
    }
    if (msg.type === 'parse-csv-stream') {
      await processCsvStreaming(msg.requestId, msg.file, msg.map, msg.storageKey, msg.sites, msg.listings, msg.users, msg.ingestRoute);
      return;
    }
    await filterFromStore(msg.requestId, msg.storageKey, msg.includeTest, msg.regionRefs, msg.initialTargetRefs, msg.raNames, msg.sites, msg.listings, msg.users);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse file.';
    self.postMessage({ type: 'error', requestId: msg.requestId, error: message });
  }
};
