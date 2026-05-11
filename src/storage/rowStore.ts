export type RowLocation = { offset: number; length: number } | number;

export interface RowStore {
  open(key: string): Promise<void>;
  appendBatch(rows: Record<string, string>[]): Promise<RowLocation[]>;
  finalizeAppend(): Promise<void>;
  streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]>;
  readByLocations(locs: RowLocation[], batchSize: number): AsyncGenerator<Record<string, string>[]>;
  clear(key?: string): Promise<void>;
  getRowCount(): number;
  getEngine(): 'opfs' | 'idb';
}

type StoredRow = { dataset: string; initialRef: string; payload: Record<string, string> };

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

  async appendBatch(rows: Record<string, string>[]): Promise<RowLocation[]> {
    if (!rows.length) return [];
    const handle = await this.ensureWriteHandle();
    const sliceSize = 2000;
    const locations: RowLocation[] = new Array(rows.length);
    for (let start = 0; start < rows.length; start += sliceSize) {
      const end = Math.min(start + sliceSize, rows.length);
      const lineBuffers: Uint8Array[] = new Array(end - start);
      let total = 0;
      for (let i = start; i < end; i++) {
        const buf = this.encoder.encode(JSON.stringify(rows[i]) + '\n');
        lineBuffers[i - start] = buf;
        total += buf.byteLength;
      }
      const merged = new Uint8Array(total);
      let cursor = 0;
      for (let i = start; i < end; i++) {
        const buf = lineBuffers[i - start];
        // record the per-row location BEFORE writing — `length` excludes the trailing newline
        locations[i] = { offset: this.writeOffset + cursor, length: buf.byteLength - 1 };
        merged.set(buf, cursor);
        cursor += buf.byteLength;
      }
      handle.write(merged, { at: this.writeOffset });
      this.writeOffset += merged.byteLength;
    }
    this.rowCount += rows.length;
    return locations;
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

  async *readByLocations(locs: RowLocation[], batchSize: number): AsyncGenerator<Record<string, string>[]> {
    if (!locs.length) return;
    await this.finalizeAppend();
    const root = await (navigator as unknown as { storage: { getDirectory: () => Promise<FileSystemDirectoryHandle> } }).storage.getDirectory();
    const fh = await root.getFileHandle(this.fileName, { create: false });
    const handle = await (fh as unknown as { createSyncAccessHandle: () => Promise<SyncAccessHandle> }).createSyncAccessHandle();
    try {
      const decoder = new TextDecoder();
      // sort & coalesce contiguous ranges so OPFS reads are sequential
      type Range = { offset: number; end: number; entries: Array<{ offset: number; length: number }> };
      const sorted = locs
        .filter((l): l is { offset: number; length: number } => typeof l === 'object' && l !== null)
        .slice()
        .sort((a, b) => a.offset - b.offset);
      const ranges: Range[] = [];
      const COALESCE_GAP = 4096;
      for (const loc of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && loc.offset <= last.end + COALESCE_GAP) {
          last.end = Math.max(last.end, loc.offset + loc.length);
          last.entries.push(loc);
        } else {
          ranges.push({ offset: loc.offset, end: loc.offset + loc.length, entries: [loc] });
        }
      }
      let batch: Record<string, string>[] = [];
      for (const range of ranges) {
        const size = range.end - range.offset;
        const buf = new Uint8Array(size);
        handle.read(buf, { at: range.offset });
        for (const entry of range.entries) {
          const start = entry.offset - range.offset;
          const slice = buf.subarray(start, start + entry.length);
          const line = decoder.decode(slice);
          if (line) {
            batch.push(JSON.parse(line) as Record<string, string>);
            if (batch.length >= batchSize) {
              yield batch;
              batch = [];
            }
          }
        }
      }
      if (batch.length) yield batch;
    } finally {
      handle.close();
    }
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

  async appendBatch(rows: Record<string, string>[]): Promise<RowLocation[]> {
    if (!rows.length || !this.db) return [];
    const ids: number[] = new Array(rows.length);
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction('rows', 'readwrite');
      const store = tx.objectStore('rows');
      for (let i = 0; i < rows.length; i++) {
        const initialRef = rows[i].initialReferralTargetRef || '';
        const req = store.put({ dataset: this.key, initialRef, payload: rows[i] } as StoredRow);
        req.onsuccess = () => { ids[i] = req.result as number; };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    this.rowCount += rows.length;
    return ids;
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

  async *readByLocations(locs: RowLocation[], batchSize: number): AsyncGenerator<Record<string, string>[]> {
    if (!locs.length || !this.db) return;
    const ids = locs.filter((l): l is number => typeof l === 'number');
    // sort numerically so cursor.continue() advances forward — much faster than random gets
    ids.sort((a, b) => a - b);
    let buffer: Record<string, string>[] = [];
    let idx = 0;
    while (idx < ids.length) {
      // process in chunks within a single read transaction for throughput
      const chunkEnd = Math.min(idx + 5000, ids.length);
      const chunk = ids.slice(idx, chunkEnd);
      idx = chunkEnd;
      const fetched = await new Promise<Array<Record<string, string> | null>>((resolve, reject) => {
        const out: Array<Record<string, string> | null> = new Array(chunk.length);
        const tx = this.db!.transaction('rows', 'readonly');
        const store = tx.objectStore('rows');
        for (let i = 0; i < chunk.length; i++) {
          const req = store.get(chunk[i]);
          req.onsuccess = () => {
            const v = req.result as StoredRow | undefined;
            out[i] = v ? v.payload : null;
          };
        }
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      for (const row of fetched) {
        if (!row) continue;
        buffer.push(row);
        if (buffer.length >= batchSize) {
          yield buffer;
          buffer = [];
        }
      }
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
