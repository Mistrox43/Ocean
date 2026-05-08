/// <reference lib="webworker" />
import * as XLSX from 'xlsx';
import type { HeaderDiag, ReferralAnalytics } from '@/types';
import { createRowStore, type RowStore } from '@/storage/rowStore';
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

let rowStore: RowStore | null = null;
const getStore = async () => {
  if (!rowStore) rowStore = await createRowStore();
  return rowStore;
};

let cachedStorageKey = '';
let baseAnalytics: ReferralAnalytics | null = null;

const noFilters = (includeTest: boolean, regionRefs: string[], initialTargetRefs: string[] | undefined, raNames: string[] | undefined) =>
  includeTest && regionRefs.length === 0 && (!initialTargetRefs || !initialTargetRefs.length) && (!raNames || !raNames.length);

const processCsvStreaming = async (requestId: number, file: File, map: Record<string, string>, storageKey: string, sites: Record<string, string>[] | null, listings: Record<string, string>[] | null, users: Record<string, string>[] | null, ingestRoute: 'auto' | 'small' | 'large') => {
  const store = await getStore();
  await store.open(storageKey);
  await store.clear(storageKey);
  cachedStorageKey = storageKey;
  baseAnalytics = null;
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let processedBytes = 0;
  let headersRaw: string[] | null = null;
  let firstDataRow: string[] | null = null;
  let appendBuffer: Record<string, string>[] = [];
  const acc = new ReferralAnalyticsAccumulator({ sites, listings, users });
  const required = ['referralCreationDate', 'referralRef', 'referralTargetRef'];
  let mismatchedRows = 0;
  let missingRequiredRows = 0;
  let invalidDateRows = 0;
  const omittedSamples: Array<{
    reasonCode: 'MISMATCHED_FIELD_COUNT' | 'MISSING_REQUIRED';
    lineNumber: number;
    referralRef: string;
    referralCreationDate: string;
    rawPreview: string;
    parsedFieldCount: number;
    expectedFieldCount: number;
  }> = [];
  const omittedSampleLimit = 100;
  const corruptionThreshold = 0.02;
  let totalParsedRows = 0;

  let inQuotes = false;
  let field = '';
  let rowParts: string[] = [];
  let lastProgressBytes = 0;
  const processParts = (parts: string[]) => {
    if (!parts.length || (parts.length === 1 && !parts[0].trim())) return;
    if (!headersRaw) {
      headersRaw = parts.map(p => p.trim());
      return;
    }
    totalParsedRows++;
    if (parts.length !== headersRaw.length) {
      mismatchedRows++;
      if (omittedSamples.length < omittedSampleLimit) {
        const referralRefHeaderIndex = headersRaw.findIndex(h => mapHeader(h, map) === 'referralRef');
        const referralCreationDateHeaderIndex = headersRaw.findIndex(h => mapHeader(h, map) === 'referralCreationDate');
        omittedSamples.push({
          reasonCode: 'MISMATCHED_FIELD_COUNT',
          lineNumber: totalParsedRows + 1,
          referralRef: referralRefHeaderIndex >= 0 ? normalize(parts[referralRefHeaderIndex] ?? '') : '',
          referralCreationDate: referralCreationDateHeaderIndex >= 0 ? normalize(parts[referralCreationDateHeaderIndex] ?? '') : '',
          rawPreview: parts.join(',').slice(0, 220),
          parsedFieldCount: parts.length,
          expectedFieldCount: headersRaw.length,
        });
      }
      return;
    }
    if (!firstDataRow) firstDataRow = parts;
    const row: Record<string, string> = {};
    for (let i = 0; i < headersRaw.length; i++) row[mapHeader(headersRaw[i], map)] = normalize(parts[i] ?? '');
    const missingRequired = required.some(k => !row[k]);
    if (missingRequired) {
      missingRequiredRows++;
      if (omittedSamples.length < omittedSampleLimit) {
        omittedSamples.push({
          reasonCode: 'MISSING_REQUIRED',
          lineNumber: totalParsedRows + 1,
          referralRef: row.referralRef || '',
          referralCreationDate: row.referralCreationDate || '',
          rawPreview: parts.join(',').slice(0, 220),
          parsedFieldCount: parts.length,
          expectedFieldCount: headersRaw.length,
        });
      }
      return;
    }
    const d = formatDate(row.referralCreationDate || '');
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) invalidDateRows++;
    row.referralCreationDate = d;
    acc.add(row);
    appendBuffer.push(row);
  };

  postProgress(requestId, 0, file.size, 'Reading CSV...');

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    processedBytes += value.length;
    carry += decoder.decode(value, { stream: true });
    for (let i = 0; i < carry.length; i++) {
      const c = carry[i];
      if (c === '"') {
        if (inQuotes && carry[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        rowParts.push(field);
        field = '';
      } else if ((c === '\n' || c === '\r') && !inQuotes) {
        if (c === '\r' && carry[i + 1] === '\n') i++;
        rowParts.push(field);
        field = '';
        processParts(rowParts);
        rowParts = [];
      } else {
        field += c;
      }
    }
    carry = '';
    if (appendBuffer.length >= 20000) {
      await store.appendBatch(appendBuffer);
      appendBuffer = [];
    }
    const totalIssues = mismatchedRows + missingRequiredRows;
    if (totalParsedRows > 1000 && totalIssues / totalParsedRows > corruptionThreshold) throw new Error(`Large CSV parse validation failed (mismatch=${mismatchedRows}, missingRequired=${missingRequiredRows}, invalidDate=${invalidDateRows}). Try the small parser path for comparison.`);
    if (processedBytes - lastProgressBytes >= 1024 * 1024) {
      lastProgressBytes = processedBytes;
      postProgress(requestId, processedBytes, file.size, 'Parsing CSV rows...');
    }
  }

  const finalChunk = decoder.decode();
  if (finalChunk) field += finalChunk;
  if (field.length > 0 || rowParts.length > 0) {
    rowParts.push(field);
    processParts(rowParts);
  }
  if (appendBuffer.length) await store.appendBatch(appendBuffer);
  await store.finalizeAppend();

  const hdrs = (headersRaw || []) as string[];
  const headerDiag: HeaderDiag[] = hdrs.map((h, i) => ({
    raw: h,
    mapped: mapHeader(h, map),
    inMap: !!(map[h] || map[h.toLowerCase()]),
    sample: normalize(firstDataRow?.[i] ?? '').slice(0, 60),
  }));

  const analytics = acc.finalize();
  baseAnalytics = analytics;
  postProgress(requestId, file.size, file.size, 'Completed');
  self.postMessage({
    type: 'complete',
    requestId,
    headerDiag,
    analytics,
    metadata: {
      parser: 'csv-stream',
      ingestRoute,
      rowCount: store.getRowCount(),
      fileName: file.name,
      fileSize: file.size,
      storageEngine: store.getEngine(),
      storageKey,
      diagnostics: {
        sourceRows: totalParsedRows,
        acceptedRows: store.getRowCount(),
        omittedRows: mismatchedRows + missingRequiredRows,
        mismatchedRows,
        missingRequiredRows,
        invalidDateRows,
        omittedSamples,
      },
      paritySignature: `${analytics.total}|${analytics.distinctRefs}|${analytics.timeline.length}|${analytics.weekly.length}`,
    },
  });
};

const filterFromStore = async (requestId: number, storageKey: string, includeTest: boolean, regionRefs: string[] = [], initialTargetRefs: string[] | undefined, raNames: string[] | undefined, sites: Record<string, string>[] | null, listings: Record<string, string>[] | null, users: Record<string, string>[] | null) => {
  const ctx: Ctx = { sites, listings, users };
  const noFilter = noFilters(includeTest, regionRefs, initialTargetRefs, raNames);

  if (noFilter && baseAnalytics && cachedStorageKey === storageKey) {
    self.postMessage({ type: 'filtered', requestId, analytics: baseAnalytics });
    return;
  }

  const store = await getStore();
  await store.open(storageKey);
  const refSet = regionRefs.length ? new Set(regionRefs) : null;
  const initialTargetSet = initialTargetRefs?.length ? new Set(initialTargetRefs) : null;
  const raNameSet = raNames?.length ? new Set(raNames) : null;
  const acc = new ReferralAnalyticsAccumulator(ctx);
  for await (const batch of store.streamRead(50000)) {
    for (const row of batch) {
      if (!includeTest && row.sentToTestListing === 'TRUE') continue;
      if (refSet && !refSet.has(row.referralTargetRef)) continue;
      if (initialTargetSet && !initialTargetSet.has(row.initialReferralTargetRef)) continue;
      if (raNameSet && !raNameSet.has(row.raName)) continue;
      acc.add(row);
    }
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
      const store = await getStore();
      await store.open(msg.storageKey);
      await store.clear(msg.storageKey);
      cachedStorageKey = msg.storageKey;
      baseAnalytics = null;
      postProgress(msg.requestId, 0, 100, 'Reading workbook...');
      const wb = XLSX.read(msg.buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      postProgress(msg.requestId, 35, 100, 'Converting sheet to rows...');
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
      postProgress(msg.requestId, 70, 100, 'Mapping fields...');
      const acc = new ReferralAnalyticsAccumulator({ sites: msg.sites, listings: msg.listings, users: msg.users });
      let batch: Record<string, string>[] = [];
      for (let i = 0; i < raw.length; i++) {
        const src = raw[i];
        const mapped: Record<string, string> = {};
        for (const k in src) mapped[mapHeader(k, msg.map)] = normalize(src[k]);
        acc.add(mapped);
        batch.push(mapped);
        if (batch.length >= 20000) {
          await store.appendBatch(batch);
          batch = [];
        }
      }
      if (batch.length) await store.appendBatch(batch);
      await store.finalizeAppend();
      postProgress(msg.requestId, 100, 100, 'Completed');
      const analytics = acc.finalize();
      baseAnalytics = analytics;
      self.postMessage({
        type: 'complete',
        requestId: msg.requestId,
        headerDiag,
        analytics,
        metadata: {
          parser: 'xlsx-worker',
          ingestRoute: msg.ingestRoute,
          rowCount: store.getRowCount(),
          fileName: msg.fileName,
          fileSize: msg.fileSize,
          storageEngine: store.getEngine(),
          storageKey: msg.storageKey,
          diagnostics: {
            sourceRows: raw.length,
            acceptedRows: store.getRowCount(),
            omittedRows: 0,
            mismatchedRows: 0,
            missingRequiredRows: 0,
            invalidDateRows: 0,
          },
        },
      });
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
