/// <reference lib="webworker" />
import * as XLSX from 'xlsx';
import type { HeaderDiag } from '@/types';
import { createRowStore, type RowStore } from '@/storage/rowStore';
import { computeReferralAnalytics } from '@/lib/referralAnalytics';
import type { ReferralAnalytics } from '@/types';

type WorkerRequest =
  | { type: 'parse-small'; buffer: ArrayBuffer; map: Record<string, string>; fileName: string; fileSize: number; storageKey: string; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null }
  | { type: 'parse-csv-stream'; file: File; map: Record<string, string>; storageKey: string; sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null }
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

const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
};

const processCsvStreaming = async (file: File, map: Record<string, string>, storageKey: string, sites: Record<string, string>[] | null, listings: Record<string, string>[] | null, users: Record<string, string>[] | null) => {
  const store = await getStore();
  await store.open(storageKey);
  await store.clear(storageKey);
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let processedBytes = 0;
  let headersRaw: string[] | null = null;
  let firstDataRow: string[] | null = null;
  const rows: Record<string, string>[] = [];
  let appendBuffer: Record<string, string>[] = [];

  postProgress(0, file.size, 'Reading CSV...');

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    processedBytes += value.length;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = parseCsvLine(line);
      if (!headersRaw) {
        headersRaw = parts.map(p => p.trim());
        continue;
      }
      if (!firstDataRow) firstDataRow = parts;
      const row: Record<string, string> = {};
      for (let i = 0; i < headersRaw.length; i++) row[mapHeader(headersRaw[i], map)] = normalize(parts[i] ?? '');
      rows.push(row);
      appendBuffer.push(row);
      if (appendBuffer.length >= 10000) {
        await store.appendBatch(appendBuffer);
        appendBuffer = [];
      }
    }
    postProgress(processedBytes, file.size, 'Parsing CSV rows...');
  }

  const finalChunk = decoder.decode();
  if (finalChunk) carry += finalChunk;
  if (carry.trim()) {
    const parts = parseCsvLine(carry);
    if (!headersRaw) headersRaw = parts.map(p => p.trim());
    else {
      if (!firstDataRow) firstDataRow = parts;
      const row: Record<string, string> = {};
      for (let i = 0; i < headersRaw.length; i++) row[mapHeader(headersRaw[i], map)] = normalize(parts[i] ?? '');
      rows.push(row);
      appendBuffer.push(row);
    }
  }
  if (appendBuffer.length) await store.appendBatch(appendBuffer);

  const headerDiag: HeaderDiag[] = (headersRaw || []).map((h, i) => ({
    raw: h,
    mapped: mapHeader(h, map),
    inMap: !!(map[h] || map[h.toLowerCase()]),
    sample: normalize(firstDataRow?.[i] ?? '').slice(0, 60),
  }));

  const analytics = computeReferralAnalytics(rows, rows, sites, listings, users);
  self.postMessage({
    type: 'complete',
    headerDiag,
    analytics,
    metadata: { parser: 'csv-stream', rowCount: rows.length, fileName: file.name, fileSize: file.size, storageEngine: store.getEngine(), storageKey },
  });
};

const filterFromStore = async (storageKey: string, includeTest: boolean, regionRefs: string[] = [], sites: Record<string, string>[] | null, listings: Record<string, string>[] | null, users: Record<string, string>[] | null) => {
  const store = await getStore();
  await store.open(storageKey);
  const refSet = regionRefs.length ? new Set(regionRefs) : null;
  const filtered: Record<string, string>[] = [];
  for await (const batch of store.streamRead(10000)) {
    for (const row of batch) {
      if (!includeTest && row.sentToTestListing === 'TRUE') continue;
      if (refSet && !refSet.has(row.referralTargetRef)) continue;
      filtered.push(row);
    }
  }
  const analytics: ReferralAnalytics | null = computeReferralAnalytics(filtered, filtered, sites, listings, users);
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
      const rows = raw.map(row => {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) mapped[mapHeader(k, msg.map)] = normalize(v);
        return mapped;
      });
      for (let i = 0; i < rows.length; i += 10000) await store.appendBatch(rows.slice(i, i + 10000));
      postProgress(100, 100, 'Completed');
      self.postMessage({
        type: 'complete',
        headerDiag,
        analytics: computeReferralAnalytics(rows, rows, msg.sites, msg.listings, msg.users),
        metadata: { parser: 'xlsx-worker', rowCount: rows.length, fileName: msg.fileName, fileSize: msg.fileSize, storageEngine: store.getEngine(), storageKey: msg.storageKey },
      });
      return;
    }
    if (msg.type === 'parse-csv-stream') {
      await processCsvStreaming(msg.file, msg.map, msg.storageKey, msg.sites, msg.listings, msg.users);
      return;
    }
    await filterFromStore(msg.storageKey, msg.includeTest, msg.regionRefs, msg.sites, msg.listings, msg.users);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse file.';
    self.postMessage({ type: 'error', error: message });
  }
};
