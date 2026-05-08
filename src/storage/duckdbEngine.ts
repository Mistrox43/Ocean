import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?worker&url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?worker&url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function createDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!, { type: 'module' });
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({ query: { castBigIntToDouble: true, castTimestampToDate: true } });
  return db;
}

export async function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = createDb();
  return dbPromise;
}

export async function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = (async () => {
      const db = await getDb();
      const c = await db.connect();
      await c.query(`PRAGMA memory_limit='1GB'`);
      return c;
    })();
  }
  return connPromise;
}

export async function runSql(sql: string): Promise<void> {
  const c = await getConn();
  await c.query(sql);
}

export async function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const c = await getConn();
  const table = await c.query(sql);
  return table.toArray().map((r: unknown) => {
    const row = r as { toJSON: () => T };
    return row.toJSON();
  });
}

export async function registerFile(name: string, buffer: Uint8Array): Promise<void> {
  const db = await getDb();
  await db.registerFileBuffer(name, buffer);
}

export async function registerFileHandle(name: string, file: File): Promise<void> {
  const db = await getDb();
  await db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
}

export async function dropFile(name: string): Promise<void> {
  const db = await getDb();
  try {
    await db.dropFile(name);
  } catch {
    /* ignore */
  }
}
