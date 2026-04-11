/// <reference lib="webworker" />
import * as XLSX from 'xlsx';
import type { HeaderDiag } from '@/types';
import { createRowStore, type RowStore } from '@/storage/rowStore';
import { ReferralAnalyticsAccumulator } from '@/lib/referralAnalyticsAccumulator';
import { formatDate } from '@/utils';

type WorkerRequest =
  | { type: 'parse-small'; buffer: ArrayBuffer; map: Record<string, string>; fileName: string; fileSize: number; storageKey: string; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null; ingestRoute: 'auto' | 'small' | 'large' }
  | { type: 'parse-csv-stream'; file: File; map: Record<string, string>; storageKey: string; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null; ingestRoute: 'auto' | 'small' | 'large' }
  | { type: 'filter-from-store'; storageKey: string; includeTest: boolean; regionRefs?: string[]; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null };

type ProgressMessage = {
  type: 'progress';
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

const postProgress = (processed: number, total: number, stage: string) => {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 1000) / 10) : 0;
  const message: ProgressMessage = { type: 'progress', processed, total, pct, stage };
  self.postMessage(message);
};

let rowStore: RowStore | null = null;
const getStore = async () => {
  if (!rowStore) rowStore = await createRowStore();
  return rowStore;
};

const processCsvStreaming = async (file: File, map: Record<string, string>, storageKey: string, sites: Record<string, string>[] | null, listings: Record<string, string>[] | null, users: Record<string, string>[] | null, ingestRoute: 'auto' | 'small' | 'large') => {
  const store = await getStore();
  await store.open(storageKey);
  await store.clear(storageKey);
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
  const corruptionThreshold = 0.02;
  let totalParsedRows = 0;

  let inQuotes = false;
  let field = '';
  let rowParts: string[] = [];
  const processParts = async (parts: string[]) => {
    if (!parts.length || (parts.length === 1 && !parts[0].trim())) return;
    if (!headersRaw) {
      headersRaw = parts.map(p => p.trim());
      return;
    }
    totalParsedRows++;
    if (parts.length !== headersRaw.length) {
      mismatchedRows++;
      return;
    }
    if (!firstDataRow) firstDataRow = parts;
    const row: Record<string, string> = {};
    for (let i = 0; i < headersRaw.length; i++) row[mapHeader(headersRaw[i], map)] = normalize(parts[i] ?? '');
    const missingRequired = required.some(k => !row[k]);
    if (missingRequired) { missingRequiredRows++; return; }
    const d = formatDate(row.referralCreationDate || '');
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) invalidDateRows++;
    row.referralCreationDate = d;
    acc.add(row);
    appendBuffer.push(row);
    if (appendBuffer.length >= 10000) {
      await store.appendBatch(appendBuffer);
      appendBuffer = [];
    }
  };

  postProgress(0, file.size, 'Reading CSV...');

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
        await processParts(rowParts);
        rowParts = [];
      } else {
        field += c;
      }
    }
    carry = '';
    const totalIssues = mismatchedRows + missingRequiredRows;
    if (totalParsedRows > 1000 && totalIssues / totalParsedRows > corruptionThreshold) throw new Error(`Large CSV parse validation failed (mismatch=${mismatchedRows}, missingRequired=${missingRequiredRows}, invalidDate=${invalidDateRows}). Try the small parser path for comparison.`);
    postProgress(processedBytes, file.size, 'Parsing CSV rows...');
  }

  const finalChunk = decoder.decode();
  if (finalChunk) field += finalChunk;
  if (field.length > 0 || rowParts.length > 0) {
    rowParts.push(field);
    await processParts(rowParts);
  }
  if (appendBuffer.length) await store.appendBatch(appendBuffer);

  const hdrs = (headersRaw || []) as string[];
  const headerDiag: HeaderDiag[] = hdrs.map((h, i) => ({
    raw: h,
    mapped: mapHeader(h, map),
    inMap: !!(map[h] || map[h.toLowerCase()]),
    sample: normalize(firstDataRow?.[i] ?? '').slice(0, 60),
  }));

  const analytics = acc.finalize();
  self.postMessage({
    type: 'complete',
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
      diagnostics: { mismatchedRows, missingRequiredRows, invalidDateRows },
      paritySignature: `${analytics.total}|${analytics.distinctRefs}|${analytics.timeline.length}|${analytics.weekly.length}`,
    },
  });
};

const filterFromStore = async (storageKey: string, includeTest: boolean, regionRefs: string[] = [], sites: Record<string, string>[] | null, listings: Record<string, string>[] | null, users: Record<string, string>[] | null) => {
  const store = await getStore();
  await store.open(storageKey);
  const refSet = regionRefs.length ? new Set(regionRefs) : null;
  const acc = new ReferralAnalyticsAccumulator({ sites, listings, users });
  for await (const batch of store.streamRead(10000)) {
    for (const row of batch) {
      if (!includeTest && row.sentToTestListing === 'TRUE') continue;
      if (refSet && !refSet.has(row.referralTargetRef)) continue;
      acc.add(row);
    }
  }
  const analytics = acc.finalize();
  self.postMessage({ type: 'filtered', analytics });
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'parse-small') {
      const store = await getStore();
      await store.open(msg.storageKey);
      await store.clear(msg.storageKey);
      postProgress(0, 100, 'Reading workbook...');
      const wb = XLSX.read(msg.buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      postProgress(35, 100, 'Converting sheet to rows...');
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
      postProgress(70, 100, 'Mapping fields...');
      const acc = new ReferralAnalyticsAccumulator({ sites: msg.sites, listings: msg.listings, users: msg.users });
      const batch: Record<string, string>[] = [];
      for (const row of raw) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) mapped[mapHeader(k, msg.map)] = normalize(v);
        acc.add(mapped);
        batch.push(mapped);
        if (batch.length >= 10000) {
          await store.appendBatch(batch.splice(0, batch.length));
        }
      }
      if (batch.length) await store.appendBatch(batch);
      postProgress(100, 100, 'Completed');
      self.postMessage({
        type: 'complete',
        headerDiag,
        analytics: acc.finalize(),
        metadata: { parser: 'xlsx-worker', ingestRoute: msg.ingestRoute, rowCount: store.getRowCount(), fileName: msg.fileName, fileSize: msg.fileSize, storageEngine: store.getEngine(), storageKey: msg.storageKey },
      });
      return;
    }
    if (msg.type === 'parse-csv-stream') {
      await processCsvStreaming(msg.file, msg.map, msg.storageKey, msg.sites, msg.listings, msg.users, msg.ingestRoute);
      return;
    }
    await filterFromStore(msg.storageKey, msg.includeTest, msg.regionRefs, msg.sites, msg.listings, msg.users);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse file.';
    self.postMessage({ type: 'error', error: message });
  }
};
