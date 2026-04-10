import { useCallback, useEffect, useRef, useState } from 'react';
import type { HeaderDiag, ReferralAnalytics } from '@/types';
import FileParserWorker from '@/workers/file-parser.worker?worker&inline';

const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export type ParseProgress = { processed: number; total: number; pct: number; stage: string };
export type IngestMetadata = { parser: 'csv-stream' | 'xlsx-worker'; rowCount: number; fileName: string; fileSize: number; storageEngine: 'opfs' | 'idb'; storageKey: string };

type WorkerMessage =
  | { type: 'progress'; processed: number; total: number; pct: number; stage: string }
  | { type: 'complete'; headerDiag: HeaderDiag[]; metadata: IngestMetadata; analytics: ReferralAnalytics | null }
  | { type: 'filtered'; analytics: ReferralAnalytics | null }
  | { type: 'error'; error: string };

export function useFileParser() {
  const workerRef = useRef<Worker | null>(null);
  const [headerDiag, setHeaderDiag] = useState<HeaderDiag[] | null>(null);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [metadata, setMetadata] = useState<IngestMetadata | null>(null);
  const [analytics, setAnalytics] = useState<ReferralAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const destroyWorker = useCallback(() => {
    if (workerRef.current) workerRef.current.terminate();
    workerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    destroyWorker();
    setHeaderDiag(null);
    setProgress(null);
    setMetadata(null);
    setAnalytics(null);
    setError(null);
    setIsLoading(false);
  }, [destroyWorker]);

  const ingest = useCallback(async (
    file: File,
    map: Record<string, string>,
    _usedFields: unknown,
    storageKey: string,
    ctx?: { sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null },
  ) => {
    try {
      const ext = file.name.toLowerCase().split('.').pop() || '';
      const isXlsx = ext === 'xlsx' || ext === 'xls';
      const isCsv = ext === 'csv';
      if (isXlsx && file.size >= LARGE_FILE_BYTES) {
        setError('This file is too large for XLSX format. Please export as CSV and re-upload.');
        return;
      }
      if (!isCsv && !isXlsx) {
        setError('Unsupported file format. Please upload CSV, XLSX, or XLS.');
        return;
      }

      destroyWorker();
      const worker = new FileParserWorker();
      workerRef.current = worker;
      setHeaderDiag(null);
      setMetadata(null);
      setAnalytics(null);
      setError(null);
      setProgress({ processed: 0, total: file.size, pct: 0, stage: 'Preparing ingest...' });
      setIsLoading(true);

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        if (msg.type === 'progress') {
          setProgress({ processed: msg.processed, total: msg.total, pct: msg.pct, stage: msg.stage });
          return;
        }
        if (msg.type === 'error') {
          setError(msg.error);
          setIsLoading(false);
          destroyWorker();
          return;
        }
        if (msg.type === 'filtered') {
          setAnalytics(msg.analytics);
          setIsLoading(false);
          return;
        }
        setHeaderDiag(msg.headerDiag);
        setMetadata(msg.metadata);
        setAnalytics(msg.analytics);
        setProgress({ processed: msg.metadata.fileSize, total: msg.metadata.fileSize, pct: 100, stage: 'Completed' });
        setIsLoading(false);
      };

      if (isCsv && file.size >= LARGE_FILE_BYTES) {
        worker.postMessage({ type: 'parse-csv-stream', file, map, storageKey, sites: ctx?.sites || null, listings: ctx?.listings || null, users: ctx?.users || null });
        return;
      }
      const buffer = await file.arrayBuffer();
      worker.postMessage({ type: 'parse-small', buffer, map, fileName: file.name, fileSize: file.size, storageKey, sites: ctx?.sites || null, listings: ctx?.listings || null, users: ctx?.users || null }, [buffer]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to ingest file.');
      setIsLoading(false);
      destroyWorker();
    }
  }, [destroyWorker]);

  const recomputeFromStore = useCallback((storageKey: string, includeTest: boolean, regionRefs: string[], ctx?: { sites: Record<string, string>[] | null; listings: Record<string, string>[] | null; users: Record<string, string>[] | null }) => {
    if (!workerRef.current) return;
    setIsLoading(true);
    setProgress(p => p ? { ...p, stage: 'Applying filters from storage...' } : { processed: 0, total: 0, pct: 0, stage: 'Applying filters from storage...' });
    workerRef.current.postMessage({ type: 'filter-from-store', storageKey, includeTest, regionRefs, sites: ctx?.sites || null, listings: ctx?.listings || null, users: ctx?.users || null });
  }, []);

  useEffect(() => () => destroyWorker(), [destroyWorker]);

  return { ingest, recomputeFromStore, progress, metadata, headerDiag, analytics, error, isLoading, reset };
}
