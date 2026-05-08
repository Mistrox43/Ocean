export interface RowStore {
  open(key: string): Promise<void>;
  appendBatch(rows: Record<string, string>[]): Promise<void>;
  finalizeAppend(): Promise<void>;
  streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]>;
  clear(key?: string): Promise<void>;
  getRowCount(): number;
  getEngine(): 'opfs' | 'idb';
}

type StoredRow = { dataset: string; payload: Record<string, string> };

type SyncAccessHandle = {
  write(buffer: BufferSource, options?: { at?: number }): number;
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  getSize(): number;
  truncate(newSize: number): void;
  flush(): void;
  close(): void;
};

class OPFSRowStore implements RowStore {
  private key = '';
  private fileName = '';
  private rowCount = 0;
  private writeHandle: SyncAccessHandle | null = null;
  private writeOffset = 0;
  private encoder = new TextEncoder();

  async open(key: string): Promise<void> {
    this.key = key;
    this.fileName = `${key}.jsonl`;
    this.rowCount = 0;
    const root = await (navigator as unknown as { storage: { getDirectory: () => Promise<FileSystemDirectoryHandle> } }).storage.getDirectory();
    await root.getFileHandle(this.fileName, { create: true });
  }

  private async ensureWriteHandle(): Promise<SyncAccessHandle> {
    if (this.writeHandle) return this.writeHandle;
    const root = await (navigator as unknown as { storage: { getDirectory: () => Promise<FileSystemDirectoryHandle> } }).storage.getDirectory();
    const fh = await root.getFileHandle(this.fileName, { create: true });
    const handle = await (fh as unknown as { createSyncAccessHandle: () => Promise<SyncAccessHandle> }).createSyncAccessHandle();
    handle.truncate(0);
    this.writeHandle = handle;
    this.writeOffset = 0;
    return handle;
  }

  async appendBatch(rows: Record<string, string>[]): Promise<void> {
    if (!rows.length) return;
    const handle = await this.ensureWriteHandle();
    const sliceSize = 2000;
    for (let start = 0; start < rows.length; start += sliceSize) {
      const end = Math.min(start + sliceSize, rows.length);
      const lines: string[] = new Array(end - start);
      for (let i = start; i < end; i++) lines[i - start] = JSON.stringify(rows[i]);
      const bytes = this.encoder.encode(lines.join('\n') + '\n');
      handle.write(bytes, { at: this.writeOffset });
      this.writeOffset += bytes.byteLength;
    }
    this.rowCount += rows.length;
  }

  async finalizeAppend(): Promise<void> {
    if (!this.writeHandle) return;
    try {
      this.writeHandle.flush();
    } finally {
      this.writeHandle.close();
      this.writeHandle = null;
    }
  }

  async *streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]> {
    await this.finalizeAppend();
    const root = await (navigator as unknown as { storage: { getDirectory: () => Promise<FileSystemDirectoryHandle> } }).storage.getDirectory();
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
      let nl = carry.indexOf('\n');
      while (nl !== -1) {
        const line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        if (line) {
          batch.push(JSON.parse(line) as Record<string, string>);
          if (batch.length >= batchSize) {
            yield batch;
            batch = [];
          }
        }
        nl = carry.indexOf('\n');
      }
    }
    carry += decoder.decode();
    if (carry) {
      const trimmed = carry.replace(/[\r\n]+$/, '');
      if (trimmed) batch.push(JSON.parse(trimmed) as Record<string, string>);
    }
    if (batch.length) yield batch;
  }

  async clear(key?: string): Promise<void> {
    if (this.writeHandle) {
      try { this.writeHandle.close(); } catch { /* ignore */ }
      this.writeHandle = null;
      this.writeOffset = 0;
    }
    const target = `${key || this.key}.jsonl`;
    const root = await (navigator as unknown as { storage: { getDirectory: () => Promise<FileSystemDirectoryHandle> } }).storage.getDirectory();
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
    if (!this.db) {
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
    }
    this.rowCount = await this.countDataset(key);
  }

  private async countDataset(key: string): Promise<number> {
    if (!this.db) return 0;
    return new Promise<number>((resolve, reject) => {
      const tx = this.db!.transaction('rows', 'readonly');
      const req = tx.objectStore('rows').index('dataset').count(IDBKeyRange.only(key));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async appendBatch(rows: Record<string, string>[]): Promise<void> {
    if (!rows.length || !this.db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction('rows', 'readwrite');
      const store = tx.objectStore('rows');
      for (let i = 0; i < rows.length; i++) store.put({ dataset: this.key, payload: rows[i] } as StoredRow);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    this.rowCount += rows.length;
  }

  async finalizeAppend(): Promise<void> {
    // No-op for IDB.
  }

  async *streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]> {
    if (!this.db) return;
    let buffer: Record<string, string>[] = [];
    const tx = this.db.transaction('rows', 'readonly');
    const cursorReq = tx.objectStore('rows').index('dataset').openCursor(IDBKeyRange.only(this.key));
    while (true) {
      const cursor = await new Promise<IDBCursorWithValue | null>((resolve, reject) => {
        cursorReq.onsuccess = () => resolve(cursorReq.result);
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      if (!cursor) break;
      const value = cursor.value as StoredRow;
      buffer.push(value.payload);
      if (buffer.length >= batchSize) {
        yield buffer;
        buffer = [];
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
  const supportsOPFS = typeof navigator !== 'undefined'
    && !!(navigator as unknown as { storage?: { getDirectory?: () => Promise<unknown> } }).storage?.getDirectory
    && typeof (FileSystemFileHandle as unknown as { prototype?: { createSyncAccessHandle?: unknown } })?.prototype?.createSyncAccessHandle === 'function';
  if (supportsOPFS) return new OPFSRowStore();
  return new IDBRowStore();
}
