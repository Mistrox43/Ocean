import { useCallback, useState } from 'react';
import type { HeaderDiag } from '@/types';
import FileParserWorker from '@/workers/file-parser.worker?worker&inline';

type WorkerMessage =
  | { type: 'tabular-complete'; requestId: number; rows: Record<string, string>[]; headerDiag: HeaderDiag[] }
  | { type: 'error'; requestId: number; error: string };

export type TabularParseResult = {
  rows: Record<string, string>[];
  headerDiag: HeaderDiag[];
};

export function useTabularParser() {
  const [isLoading, setIsLoading] = useState(false);

  const parse = useCallback(async (file: File, map: Record<string, string>): Promise<TabularParseResult> => {
    setIsLoading(true);
    const worker = new FileParserWorker();
    try {
      const buffer = await file.arrayBuffer();
      return await new Promise<TabularParseResult>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          const msg = event.data;
          if (msg.type === 'tabular-complete') resolve({ rows: msg.rows, headerDiag: msg.headerDiag });
          else if (msg.type === 'error') reject(new Error(msg.error));
        };
        worker.onerror = (event) => reject(new Error(event.message || 'Worker error during parse.'));
        worker.postMessage({ type: 'parse-tabular', requestId: 1, buffer, map }, [buffer]);
      });
    } finally {
      worker.terminate();
      setIsLoading(false);
    }
  }, []);

  return { parse, isLoading };
}
