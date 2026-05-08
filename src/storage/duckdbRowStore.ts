import { getConn, registerFileHandle, dropFile, runSql, queryRows } from './duckdbEngine';

const TABLE = (key: string) => `t_${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class DuckDbRowStore {
  private key = '';
  private rowCount = 0;
  private columns: string[] = [];

  async open(key: string): Promise<void> {
    this.key = key;
    const table = TABLE(key);
    const rows = await queryRows<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main' AND table_name = ${sqlLit(table)}`
    );
    if (rows.length) {
      const cnt = await queryRows<{ n: number }>(`SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)}`);
      this.rowCount = Number(cnt[0]?.n || 0);
      const cols = await queryRows<{ name: string }>(
        `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = ${sqlLit(table)} ORDER BY ordinal_position`
      );
      this.columns = cols.map(c => c.name);
    } else {
      this.rowCount = 0;
      this.columns = [];
    }
  }

  async ingestCsvFile(file: File, headerMap: Record<string, string>): Promise<void> {
    const table = TABLE(this.key);
    const fileName = `upload_${this.key}.csv`;
    await dropFile(fileName);
    await registerFileHandle(fileName, file);

    const conn = await getConn();
    const descTable = await conn.query(
      `SELECT column_name, column_type FROM (DESCRIBE SELECT * FROM read_csv_auto(${sqlLit(fileName)}, header=true, sample_size=5000))`
    );
    const descRows = descTable.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string; column_type: string } }).toJSON());
    const rawHeaders = descRows.map(r => r.column_name);

    const mapHeader = (h: string) => headerMap[h] || headerMap[h.toLowerCase()] || h;

    const seen = new Map<string, number>();
    const selectExprs: string[] = [];
    const canonicalNames: string[] = [];
    for (const raw of rawHeaders) {
      let canonical = mapHeader(raw);
      const count = seen.get(canonical) || 0;
      seen.set(canonical, count + 1);
      if (count > 0) canonical = `${canonical}_${count}`;
      canonicalNames.push(canonical);
      selectExprs.push(`CAST(${ident(raw)} AS VARCHAR) AS ${ident(canonical)}`);
    }

    await runSql(`DROP TABLE IF EXISTS ${ident(table)}`);
    await runSql(
      `CREATE TABLE ${ident(table)} AS SELECT ${selectExprs.join(', ')} FROM read_csv_auto(${sqlLit(fileName)}, header=true, all_varchar=true)`
    );

    await dropFile(fileName);

    this.columns = canonicalNames;
    const cnt = await queryRows<{ n: number }>(`SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)}`);
    this.rowCount = Number(cnt[0]?.n || 0);
  }

  async createFromRows(rows: Record<string, string>[]): Promise<void> {
    const table = TABLE(this.key);
    await runSql(`DROP TABLE IF EXISTS ${ident(table)}`);
    if (!rows.length) {
      this.columns = [];
      this.rowCount = 0;
      return;
    }
    const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
    this.columns = keys;
    const cols = keys.map(k => `${ident(k)} VARCHAR`).join(', ');
    await runSql(`CREATE TABLE ${ident(table)} (${cols})`);
    await this.appendBatch(rows);
  }

  async appendBatch(rows: Record<string, string>[]): Promise<void> {
    if (!rows.length) return;
    const table = TABLE(this.key);
    if (!this.columns.length) {
      const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
      this.columns = keys;
      const cols = keys.map(k => `${ident(k)} VARCHAR`).join(', ');
      await runSql(`CREATE TABLE IF NOT EXISTS ${ident(table)} (${cols})`);
    }
    const cols = this.columns;
    const chunk = 2000;
    for (let start = 0; start < rows.length; start += chunk) {
      const end = Math.min(start + chunk, rows.length);
      const values: string[] = [];
      for (let i = start; i < end; i++) {
        const row = rows[i];
        const tuple = cols.map(c => sqlLit(row[c] ?? ''));
        values.push(`(${tuple.join(',')})`);
      }
      await runSql(`INSERT INTO ${ident(table)} (${cols.map(ident).join(',')}) VALUES ${values.join(',')}`);
    }
    this.rowCount += rows.length;
  }

  async finalizeAppend(): Promise<void> {
    /* no-op */
  }

  async *streamRead(batchSize: number): AsyncGenerator<Record<string, string>[]> {
    const table = TABLE(this.key);
    if (!this.columns.length) return;
    const conn = await getConn();
    let offset = 0;
    while (offset < this.rowCount) {
      const result = await conn.query(
        `SELECT * FROM ${ident(table)} LIMIT ${batchSize} OFFSET ${offset}`
      );
      const rows = result.toArray().map((r: unknown) => {
        const obj = (r as { toJSON: () => Record<string, unknown> }).toJSON();
        const out: Record<string, string> = {};
        for (const k in obj) {
          const v = obj[k];
          out[k] = v == null ? '' : String(v);
        }
        return out;
      });
      if (!rows.length) break;
      yield rows;
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
  }

  async streamReadFiltered(batchSize: number, whereClause: string): Promise<AsyncGenerator<Record<string, string>[]>> {
    return this.streamReadWithSql(batchSize, whereClause);
  }

  private async *streamReadWithSql(batchSize: number, whereClause: string): AsyncGenerator<Record<string, string>[]> {
    const table = TABLE(this.key);
    if (!this.columns.length) return;
    const conn = await getConn();
    const where = whereClause ? `WHERE ${whereClause}` : '';
    const cnt = await queryRows<{ n: number }>(`SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)} ${where}`);
    const total = Number(cnt[0]?.n || 0);
    let offset = 0;
    while (offset < total) {
      const result = await conn.query(
        `SELECT * FROM ${ident(table)} ${where} LIMIT ${batchSize} OFFSET ${offset}`
      );
      const rows = result.toArray().map((r: unknown) => {
        const obj = (r as { toJSON: () => Record<string, unknown> }).toJSON();
        const out: Record<string, string> = {};
        for (const k in obj) {
          const v = obj[k];
          out[k] = v == null ? '' : String(v);
        }
        return out;
      });
      if (!rows.length) break;
      yield rows;
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
  }

  getColumns(): string[] {
    return [...this.columns];
  }

  getTableName(): string {
    return TABLE(this.key);
  }

  async clear(key?: string): Promise<void> {
    const target = key ? TABLE(key) : TABLE(this.key);
    await runSql(`DROP TABLE IF EXISTS ${ident(target)}`);
    if (!key || key === this.key) {
      this.rowCount = 0;
      this.columns = [];
    }
  }

  getRowCount(): number {
    return this.rowCount;
  }

  getEngine(): 'opfs' {
    return 'opfs';
  }
}
