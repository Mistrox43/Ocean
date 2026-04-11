export interface RowStore {
  open(key: string): Promise<void>;
  appendBatch(rows: Record<string, string>[]): Promise<void>;
  streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]>;
  clear(key?: string): Promise<void>;
  getRowCount(): number;
  getEngine(): 'opfs' | 'idb';
}

type StoredRow = { dataset: string; payload: Record<string, string> };

class OPFSRowStore implements RowStore {
  private key = '';
  private fileName = '';
  private rowCount = 0;

  async open(key: string): Promise<void> {
    this.key = key;
    this.fileName = `${key}.jsonl`;
    this.rowCount = 0;
    const root = await (navigator as any).storage.getDirectory();
    await root.getFileHandle(this.fileName, { create: true });
  }

  async appendBatch(rows: Record<string, string>[]): Promise<void> {
    if (!rows.length) return;
    const root = await (navigator as any).storage.getDirectory();
    const fh = await root.getFileHandle(this.fileName, { create: true });
    const ws = await fh.createWritable({ keepExistingData: true });
    const currentFile = await fh.getFile();
    await ws.seek(currentFile.size);
    const payload = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
    await ws.write(payload);
    await ws.close();
    this.rowCount += rows.length;
  }

  async *streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]> {
    const root = await (navigator as any).storage.getDirectory();
    const fh = await root.getFileHandle(this.fileName, { create: false });
    const file = await fh.getFile();
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let carry = '';
    let batch: Record<string, string>[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split('\n');
      carry = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        batch.push(JSON.parse(line) as Record<string, string>);
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }
    }
    if (carry.trim()) batch.push(JSON.parse(carry) as Record<string, string>);
    if (batch.length) yield batch;
  }

  async clear(key?: string): Promise<void> {
    const target = `${key || this.key}.jsonl`;
    const root = await (navigator as any).storage.getDirectory();
    try {
      await root.removeEntry(target);
    } catch {
      // ignore missing entry
    }
    if (!key || key === this.key) this.rowCount = 0;
  }

  getRowCount(): number {
    return this.rowCount;
  }

  getEngine(): 'opfs' {
    return 'opfs';
  }
}

class IDBRowStore implements RowStore {
  private db: IDBDatabase | null = null;
  private key = '';
  private rowCount = 0;

  async open(key: string): Promise<void> {
    this.key = key;
    this.rowCount = 0;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ocean-row-store', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('rows')) {
          const store = db.createObjectStore('rows', { keyPath: 'id', autoIncrement: true });
          store.createIndex('dataset', 'dataset', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await this.clear(key);
  }

  async appendBatch(rows: Record<string, string>[]): Promise<void> {
    if (!rows.length || !this.db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction('rows', 'readwrite');
      const store = tx.objectStore('rows');
      rows.forEach(r => store.add({ dataset: this.key, payload: r } as StoredRow));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    this.rowCount += rows.length;
  }

  async *streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]> {
    if (!this.db) return;
    const buffer: Record<string, string>[] = [];
    let cursorReq: IDBRequest<IDBCursorWithValue | null>;
    const tx = this.db.transaction('rows', 'readonly');
    const index = tx.objectStore('rows').index('dataset');
    cursorReq = index.openCursor(IDBKeyRange.only(this.key));
    while (true) {
      const cursor = await new Promise<IDBCursorWithValue | null>((resolve, reject) => {
        cursorReq.onsuccess = () => resolve(cursorReq.result);
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      if (!cursor) break;
      const value = cursor.value as StoredRow;
      buffer.push(value.payload);
      if (buffer.length >= batchSize) {
        yield [...buffer];
        buffer.length = 0;
      }
      cursor.continue();
    }
    if (buffer.length) yield buffer;
  }

  async clear(key?: string): Promise<void> {
    if (!this.db) return;
    const dataset = key || this.key;
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction('rows', 'readwrite');
      const index = tx.objectStore('rows').index('dataset');
      const req = index.openCursor(IDBKeyRange.only(dataset));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (!key || key === this.key) this.rowCount = 0;
  }

  getRowCount(): number {
    return this.rowCount;
  }

  getEngine(): 'idb' {
    return 'idb';
  }
}

export async function createRowStore(): Promise<RowStore> {
  const supportsOPFS = typeof navigator !== 'undefined' && !!(navigator as any).storage?.getDirectory;
  if (supportsOPFS) return new OPFSRowStore();
  return new IDBRowStore();
}

