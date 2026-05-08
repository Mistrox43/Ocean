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

async function registerLookupTable(
  tableName: string,
  rows: Record<string, string>[] | null,
): Promise<void> {
  const conn = await getConn();
  await conn.query(`DROP TABLE IF EXISTS ${ident(tableName)}`);
  if (!rows || !rows.length) return;
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  if (!keys.length) return;
  const cols = keys.map(k => `${ident(k)} VARCHAR`).join(', ');
  await conn.query(`CREATE TABLE ${ident(tableName)} (${cols})`);
  const chunk = 2000;
  for (let start = 0; start < rows.length; start += chunk) {
    const end = Math.min(start + chunk, rows.length);
    const values: string[] = [];
    for (let i = start; i < end; i++) {
      const row = rows[i];
      values.push(`(${keys.map(k => sqlLit(row[k] ?? '')).join(',')})`);
    }
    await conn.query(
      `INSERT INTO ${ident(tableName)} (${keys.map(ident).join(',')}) VALUES ${values.join(',')}`,
    );
  }
}

async function registerLookupTables(ctx: Ctx): Promise<void> {
  await registerLookupTable('lookup_sites', ctx.sites);
  await registerLookupTable('lookup_listings', ctx.listings);
  await registerLookupTable('lookup_users', ctx.users);
}

type SqlKpis = {
  total: number;
  distinctRefs: number;
  uniqueSendingSites: number;
  uniqueTargetSites: number;
  uniqueSenders: number;
  uniqueProfIds: number;
  uniqueTargetRefs: number;
};

async function computeSqlKpis(tableName: string, whereClause: string): Promise<SqlKpis | null> {
  const conn = await getConn();
  const colsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name=${sqlLit(tableName)}`,
  );
  const cols = new Set(
    colsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  if (!cols.size) return null;
  const exprs: string[] = ['COUNT(*)::BIGINT AS total'];
  exprs.push(
    cols.has('referralRef')
      ? `COUNT(DISTINCT ${ident('referralRef')})::BIGINT AS distinctRefs`
      : `0::BIGINT AS distinctRefs`,
  );
  exprs.push(
    cols.has('srcsiteNum')
      ? `COUNT(DISTINCT NULLIF(${ident('srcsiteNum')}, ''))::BIGINT AS uniqueSendingSites`
      : `0::BIGINT AS uniqueSendingSites`,
  );
  exprs.push(
    cols.has('siteNum')
      ? `COUNT(DISTINCT NULLIF(${ident('siteNum')}, ''))::BIGINT AS uniqueTargetSites`
      : `0::BIGINT AS uniqueTargetSites`,
  );
  exprs.push(
    cols.has('referredByUserName')
      ? `COUNT(DISTINCT NULLIF(${ident('referredByUserName')}, ''))::BIGINT AS uniqueSenders`
      : `0::BIGINT AS uniqueSenders`,
  );
  exprs.push(
    cols.has('referrerProfessionalId')
      ? `COUNT(DISTINCT NULLIF(${ident('referrerProfessionalId')}, ''))::BIGINT AS uniqueProfIds`
      : `0::BIGINT AS uniqueProfIds`,
  );
  exprs.push(
    cols.has('referralTargetRef')
      ? `COUNT(DISTINCT NULLIF(${ident('referralTargetRef')}, ''))::BIGINT AS uniqueTargetRefs`
      : `0::BIGINT AS uniqueTargetRefs`,
  );
  const where = whereClause ? `WHERE ${whereClause}` : '';
  const res = await conn.query(`SELECT ${exprs.join(', ')} FROM ${ident(tableName)} ${where}`);
  const row = res.toArray()[0] as { toJSON: () => Record<string, number> } | undefined;
  if (!row) return null;
  const j = row.toJSON();
  return {
    total: Number(j.total || 0),
    distinctRefs: Number(j.distinctRefs || 0),
    uniqueSendingSites: Number(j.uniqueSendingSites || 0),
    uniqueTargetSites: Number(j.uniqueTargetSites || 0),
    uniqueSenders: Number(j.uniqueSenders || 0),
    uniqueProfIds: Number(j.uniqueProfIds || 0),
    uniqueTargetRefs: Number(j.uniqueTargetRefs || 0),
  };
}

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
  await registerLookupTables({ sites, listings, users });
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
  const sqlKpis = await computeSqlKpis(table, '').catch(() => null);
  if (sqlKpis) {
    analytics.total = sqlKpis.total;
    analytics.distinctRefs = sqlKpis.distinctRefs;
    analytics.uniqueSendingSites = sqlKpis.uniqueSendingSites;
    analytics.uniqueTargetSites = sqlKpis.uniqueTargetSites;
    analytics.uniqueSenders = sqlKpis.uniqueSenders;
    analytics.uniqueProfIds = sqlKpis.uniqueProfIds;
    analytics.uniqueTargetRefs = sqlKpis.uniqueTargetRefs;
  }
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
  await registerLookupTables({ sites, listings, users });

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
  const filteredKpis = await computeSqlKpis(rowStore.getTableName(), whereClause).catch(() => null);
  if (filteredKpis) {
    analytics.total = filteredKpis.total;
    analytics.distinctRefs = filteredKpis.distinctRefs;
    analytics.uniqueSendingSites = filteredKpis.uniqueSendingSites;
    analytics.uniqueTargetSites = filteredKpis.uniqueTargetSites;
    analytics.uniqueSenders = filteredKpis.uniqueSenders;
    analytics.uniqueProfIds = filteredKpis.uniqueProfIds;
    analytics.uniqueTargetRefs = filteredKpis.uniqueTargetRefs;
  }
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
