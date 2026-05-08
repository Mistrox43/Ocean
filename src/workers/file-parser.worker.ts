/// <reference lib="webworker" />
import * as XLSX from 'xlsx';
import type { HeaderDiag, ReferralAnalytics } from '@/types';
import { DuckDbRowStore } from '@/storage/duckdbRowStore';
import { getConn } from '@/storage/duckdbEngine';
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

const postTelemetry = (
  requestId: number,
  event: string,
  details?: Record<string, number | string | boolean>,
) => {
  self.postMessage({
    type: 'telemetry',
    requestId,
    event,
    timestamp: Date.now(),
    details: details || {},
  });
};

const timed = async <T>(
  requestId: number,
  event: string,
  fn: () => Promise<T>,
  extraDetails?: Record<string, number | string | boolean>,
): Promise<T> => {
  const start = performance.now();
  try {
    const result = await fn();
    const elapsedMs = Math.round(performance.now() - start);
    postTelemetry(requestId, event, { elapsedMs, ok: true, ...(extraDetails || {}) });
    return result;
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - start);
    postTelemetry(requestId, event, {
      elapsedMs,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(extraDetails || {}),
    });
    throw err;
  }
};

const rowStore = new DuckDbRowStore();
let cachedStorageKey = '';
let baseAnalytics: ReferralAnalytics | null = null;

async function registerLookupTable(
  tableName: string,
  rows: Record<string, string>[] | null,
): Promise<void> {
  const conn = await getConn();
  await conn.query(`DROP TABLE IF EXISTS ${ident(tableName)}`);
  if (!rows || !rows.length) return;
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  if (!keys.length) return;
  const cols = keys.map(k => `${ident(k)} VARCHAR`).join(', ');
  await conn.query(`CREATE TABLE ${ident(tableName)} (${cols})`);
  const chunk = 2000;
  for (let start = 0; start < rows.length; start += chunk) {
    const end = Math.min(start + chunk, rows.length);
    const values: string[] = [];
    for (let i = start; i < end; i++) {
      const row = rows[i];
      values.push(`(${keys.map(k => sqlLit(row[k] ?? '')).join(',')})`);
    }
    await conn.query(
      `INSERT INTO ${ident(tableName)} (${keys.map(ident).join(',')}) VALUES ${values.join(',')}`,
    );
  }
}

async function registerLookupTables(ctx: Ctx): Promise<void> {
  await registerLookupTable('lookup_sites', ctx.sites);
  await registerLookupTable('lookup_listings', ctx.listings);
  await registerLookupTable('lookup_users', ctx.users);
}

type SqlKpis = {
  total: number;
  distinctRefs: number;
  uniqueSendingSites: number;
  uniqueTargetSites: number;
  uniqueSenders: number;
  uniqueProfIds: number;
  uniqueTargetRefs: number;
};

async function computeSqlKpis(tableName: string, whereClause: string): Promise<SqlKpis | null> {
  const conn = await getConn();
  const colsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name=${sqlLit(tableName)}`,
  );
  const cols = new Set(
    colsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  if (!cols.size) return null;
  const exprs: string[] = ['COUNT(*)::BIGINT AS total'];
  exprs.push(
    cols.has('referralRef')
      ? `COUNT(DISTINCT ${ident('referralRef')})::BIGINT AS distinctRefs`
      : `0::BIGINT AS distinctRefs`,
  );
  exprs.push(
    cols.has('srcsiteNum')
      ? `COUNT(DISTINCT NULLIF(${ident('srcsiteNum')}, ''))::BIGINT AS uniqueSendingSites`
      : `0::BIGINT AS uniqueSendingSites`,
  );
  exprs.push(
    cols.has('siteNum')
      ? `COUNT(DISTINCT NULLIF(${ident('siteNum')}, ''))::BIGINT AS uniqueTargetSites`
      : `0::BIGINT AS uniqueTargetSites`,
  );
  exprs.push(
    cols.has('referredByUserName')
      ? `COUNT(DISTINCT NULLIF(${ident('referredByUserName')}, ''))::BIGINT AS uniqueSenders`
      : `0::BIGINT AS uniqueSenders`,
  );
  exprs.push(
    cols.has('referrerProfessionalId')
      ? `COUNT(DISTINCT NULLIF(${ident('referrerProfessionalId')}, ''))::BIGINT AS uniqueProfIds`
      : `0::BIGINT AS uniqueProfIds`,
  );
  exprs.push(
    cols.has('referralTargetRef')
      ? `COUNT(DISTINCT NULLIF(${ident('referralTargetRef')}, ''))::BIGINT AS uniqueTargetRefs`
      : `0::BIGINT AS uniqueTargetRefs`,
  );
  const where = whereClause ? `WHERE ${whereClause}` : '';
  const res = await conn.query(`SELECT ${exprs.join(', ')} FROM ${ident(tableName)} ${where}`);
  const row = res.toArray()[0] as { toJSON: () => Record<string, number> } | undefined;
  if (!row) return null;
  const j = row.toJSON();
  return {
    total: Number(j.total || 0),
    distinctRefs: Number(j.distinctRefs || 0),
    uniqueSendingSites: Number(j.uniqueSendingSites || 0),
    uniqueTargetSites: Number(j.uniqueTargetSites || 0),
    uniqueSenders: Number(j.uniqueSenders || 0),
    uniqueProfIds: Number(j.uniqueProfIds || 0),
    uniqueTargetRefs: Number(j.uniqueTargetRefs || 0),
  };
}

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

type SqlAggregates = {
  timeline: { label: string; value: number; cumulative: number }[];
  weekly: { label: string; total: number; test: number; nonTest: number; senders: number; receivers: number }[];
  byRegion: { label: string; value: number }[];
  byRaName: { label: string; value: number }[];
  byService: { label: string; value: number }[];
  byClinType: { label: string; value: number }[];
  byEmrSent: { label: string; value: number }[];
  byEmrRecv: { label: string; value: number }[];
  fhirCount: number;
  earliestDate: string;
  byTarget: import('@/types').TargetSiteRow[] | null;
  bySource: import('@/types').SourceSiteRow[] | null;
  bySender: import('@/types').SenderRow[] | null;
};

function topNEntries(entries: [string, number][]): { label: string; value: number }[] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 10);
  const other = sorted.slice(10).reduce((s, e) => s + e[1], 0);
  const out: { label: string; value: number }[] = top.map(([l, v]) => ({ label: l, value: v }));
  if (other > 0) out.push({ label: 'All others', value: other });
  return out;
}

async function queryPairs(sql: string, labelCol: string, valueCol: string): Promise<[string, number][]> {
  const conn = await getConn();
  const res = await conn.query(sql);
  return res.toArray().map((r: unknown) => {
    const row = (r as { toJSON: () => Record<string, unknown> }).toJSON();
    return [String(row[labelCol] ?? ''), Number(row[valueCol] ?? 0)] as [string, number];
  });
}

async function computeSqlAggregates(tableName: string, whereClause: string): Promise<SqlAggregates | null> {
  const conn = await getConn();
  const colsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name=${sqlLit(tableName)}`,
  );
  const cols = new Set(
    colsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  if (!cols.size) return null;
  const where = whereClause ? `WHERE ${whereClause}` : '';
  const prefix = whereClause ? `AND ${whereClause}` : '';

  const timeline: { label: string; value: number; cumulative: number }[] = [];
  let earliestDate = '';
  if (cols.has('referralCreationDate')) {
    const monthlyRes = await conn.query(
      `SELECT substring(${ident('referralCreationDate')}, 1, 7) AS m, COUNT(*)::BIGINT AS n
       FROM ${ident(tableName)}
       WHERE length(${ident('referralCreationDate')}) >= 7 ${prefix}
       GROUP BY m
       ORDER BY m`,
    );
    let cum = 0;
    for (const r of monthlyRes.toArray()) {
      const row = (r as { toJSON: () => { m: string; n: number } }).toJSON();
      const v = Number(row.n || 0);
      cum += v;
      timeline.push({ label: String(row.m), value: v, cumulative: cum });
    }
    const minRes = await conn.query(
      `SELECT MIN(${ident('referralCreationDate')}) AS d
       FROM ${ident(tableName)}
       WHERE regexp_matches(${ident('referralCreationDate')}, '^\\d{4}-\\d{2}-\\d{2}') ${prefix}`,
    );
    const minRow = minRes.toArray()[0] as { toJSON: () => { d: string | null } } | undefined;
    earliestDate = minRow ? String(minRow.toJSON().d ?? '').slice(0, 10) : '';
  }

  const weekly: { label: string; total: number; test: number; nonTest: number; senders: number; receivers: number }[] = [];
  if (cols.has('referralCreationDate')) {
    const testExpr = cols.has('sentToTestListing')
      ? `CASE WHEN ${ident('sentToTestListing')} = 'TRUE' THEN 1 ELSE 0 END`
      : `0`;
    const nonTestExpr = cols.has('sentToTestListing')
      ? `CASE WHEN ${ident('sentToTestListing')} = 'TRUE' THEN 0 ELSE 1 END`
      : `1`;
    const profExpr = cols.has('referrerProfessionalId') && cols.has('sentToTestListing')
      ? `CASE WHEN ${ident('sentToTestListing')} <> 'TRUE' THEN NULLIF(${ident('referrerProfessionalId')}, '') END`
      : cols.has('referrerProfessionalId')
        ? `NULLIF(${ident('referrerProfessionalId')}, '')`
        : `NULL`;
    const recvExpr = cols.has('referralTargetRef') && cols.has('sentToTestListing')
      ? `CASE WHEN ${ident('sentToTestListing')} <> 'TRUE' THEN NULLIF(${ident('referralTargetRef')}, '') END`
      : cols.has('referralTargetRef')
        ? `NULLIF(${ident('referralTargetRef')}, '')`
        : `NULL`;
    const weeklyRes = await conn.query(
      `SELECT strftime(date_trunc('week', TRY_CAST(${ident('referralCreationDate')} AS DATE)), '%Y-%m-%d') AS wk,
              COUNT(*)::BIGINT AS total,
              SUM(${testExpr})::BIGINT AS test,
              SUM(${nonTestExpr})::BIGINT AS nonTest,
              COUNT(DISTINCT ${profExpr})::BIGINT AS senders,
              COUNT(DISTINCT ${recvExpr})::BIGINT AS receivers
       FROM ${ident(tableName)}
       WHERE TRY_CAST(${ident('referralCreationDate')} AS DATE) IS NOT NULL ${prefix}
       GROUP BY wk
       ORDER BY wk`,
    );
    for (const r of weeklyRes.toArray()) {
      const row = (r as { toJSON: () => { wk: string; total: number; test: number; nonTest: number; senders: number; receivers: number } }).toJSON();
      weekly.push({
        label: String(row.wk ?? ''),
        total: Number(row.total || 0),
        test: Number(row.test || 0),
        nonTest: Number(row.nonTest || 0),
        senders: Number(row.senders || 0),
        receivers: Number(row.receivers || 0),
      });
    }
  }

  let byRegion: { label: string; value: number }[] = [];
  if (cols.has('referralTargetRef')) {
    const hasListings = await conn.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='lookup_listings' AND column_name IN ('ref', 'healthRegion')`,
    );
    const listingCols = new Set(
      hasListings.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
    );
    if (listingCols.has('ref') && listingCols.has('healthRegion')) {
      const pairs = await queryPairs(
        `SELECT COALESCE(
             NULLIF(l.${ident('healthRegion')}, ''),
             CASE WHEN l.${ident('ref')} IS NULL THEN 'Referrals not mapped to listings' ELSE 'Region not defined' END
           ) AS label,
           COUNT(*)::BIGINT AS value
         FROM ${ident(tableName)} r
         LEFT JOIN ${ident('lookup_listings')} l ON l.${ident('ref')} = r.${ident('referralTargetRef')}
         ${where}
         GROUP BY label`,
        'label',
        'value',
      );
      byRegion = topNEntries(pairs);
    }
  }

  let byRaName: { label: string; value: number }[] = [];
  if (cols.has('raName')) {
    const pairs = await queryPairs(
      `SELECT COALESCE(NULLIF(${ident('raName')}, ''), 'Unknown') AS label, COUNT(*)::BIGINT AS value
       FROM ${ident(tableName)} ${where}
       GROUP BY label`,
      'label',
      'value',
    );
    byRaName = topNEntries(pairs);
  }

  let byService: { label: string; value: number }[] = [];
  {
    const hasCurrent = cols.has('currentHealthService');
    const hasInitial = cols.has('initialHealthService');
    if (hasCurrent || hasInitial) {
      const expr = hasCurrent && hasInitial
        ? `COALESCE(NULLIF(${ident('currentHealthService')}, ''), NULLIF(${ident('initialHealthService')}, ''), 'Unknown')`
        : hasCurrent
          ? `COALESCE(NULLIF(${ident('currentHealthService')}, ''), 'Unknown')`
          : `COALESCE(NULLIF(${ident('initialHealthService')}, ''), 'Unknown')`;
      const pairs = await queryPairs(
        `SELECT ${expr} AS label, COUNT(*)::BIGINT AS value
         FROM ${ident(tableName)} ${where}
         GROUP BY label`,
        'label',
        'value',
      );
      byService = topNEntries(pairs);
    }
  }

  let byClinType: { label: string; value: number }[] = [];
  if (cols.has('referrerClinicianType')) {
    const pairs = await queryPairs(
      `SELECT COALESCE(NULLIF(${ident('referrerClinicianType')}, ''), 'Unknown') AS label, COUNT(*)::BIGINT AS value
       FROM ${ident(tableName)} ${where}
       GROUP BY label`,
      'label',
      'value',
    );
    byClinType = topNEntries(pairs);
  }

  let byEmrSent: { label: string; value: number }[] = [];
  let byEmrRecv: { label: string; value: number }[] = [];
  {
    const siteCols = await conn.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='lookup_sites' AND column_name IN ('siteNumber', 'emr')`,
    );
    const sCols = new Set(
      siteCols.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
    );
    const siteNormExpr = (col: string) =>
      `CAST(TRY_CAST(regexp_replace(${col}, '\\.0+$', '') AS INTEGER) AS VARCHAR)`;
    if (sCols.has('siteNumber') && sCols.has('emr') && cols.has('srcsiteNum')) {
      const pairs = await queryPairs(
        `SELECT COALESCE(NULLIF(s.${ident('emr')}, ''), 'Unknown EMR') AS label, COUNT(*)::BIGINT AS value
         FROM ${ident(tableName)} r
         LEFT JOIN ${ident('lookup_sites')} s ON ${siteNormExpr(`s.${ident('siteNumber')}`)} = ${siteNormExpr(`r.${ident('srcsiteNum')}`)}
         ${where}
         GROUP BY label
         ORDER BY value DESC`,
        'label',
        'value',
      );
      byEmrSent = pairs.map(([l, v]) => ({ label: l || 'None', value: v }));
    }
    if (sCols.has('siteNumber') && sCols.has('emr') && cols.has('siteNum')) {
      const pairs = await queryPairs(
        `SELECT COALESCE(NULLIF(s.${ident('emr')}, ''), 'Unknown EMR') AS label, COUNT(*)::BIGINT AS value
         FROM ${ident(tableName)} r
         LEFT JOIN ${ident('lookup_sites')} s ON ${siteNormExpr(`s.${ident('siteNumber')}`)} = ${siteNormExpr(`r.${ident('siteNum')}`)}
         ${where}
         GROUP BY label
         ORDER BY value DESC`,
        'label',
        'value',
      );
      byEmrRecv = pairs.map(([l, v]) => ({ label: l || 'None', value: v }));
    }
  }

  const siteNormExprCol = (col: string) =>
    `CAST(TRY_CAST(regexp_replace(COALESCE(${col}, ''), '\\.0+$', '') AS INTEGER) AS VARCHAR)`;

  const siteMetaColsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='lookup_sites'`,
  );
  const siteMetaCols = new Set(
    siteMetaColsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  const siteNameJoinable = siteMetaCols.has('siteNumber') && siteMetaCols.has('siteName');

  const listingMetaColsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='lookup_listings'`,
  );
  const listingMetaCols = new Set(
    listingMetaColsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  const listingTitleJoinable = listingMetaCols.has('ref') && listingMetaCols.has('title');

  const userMetaColsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='lookup_users'`,
  );
  const userMetaCols = new Set(
    userMetaColsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  const userNameJoinable = userMetaCols.has('userName');

  let byTarget: import('@/types').TargetSiteRow[] | null = null;
  if (cols.has('siteNum')) {
    const senderExpr = cols.has('referredByUserName')
      ? `COUNT(DISTINCT NULLIF(r.${ident('referredByUserName')}, ''))::BIGINT`
      : `0::BIGINT`;
    const stateExpr = cols.has('referralState')
      ? `map_from_entries(list_zip(list(DISTINCT COALESCE(NULLIF(r.${ident('referralState')}, ''), 'UNKNOWN')), [0]))`
      : `MAP()`;
    const sn = siteNormExprCol(`r.${ident('siteNum')}`);
    const joinS = siteNameJoinable
      ? `LEFT JOIN ${ident('lookup_sites')} s ON ${siteNormExprCol(`s.${ident('siteNumber')}`)} = ${sn}`
      : '';
    const tgtSql = `
      SELECT ${sn} AS siteNum,
             ${siteNameJoinable ? `ANY_VALUE(s.${ident('siteName')})` : `ANY_VALUE(${cols.has('recipientName') ? `r.${ident('recipientName')}` : sn})`} AS siteName,
             COUNT(*)::BIGINT AS totalRefs,
             ${senderExpr} AS uniqueSenders
      FROM ${ident(tableName)} r ${joinS}
      ${where}
      GROUP BY siteNum
      ORDER BY totalRefs DESC
    `;
    const tgtRes = await conn.query(tgtSql);
    const baseRows = tgtRes.toArray().map((r: unknown) => (r as { toJSON: () => Record<string, unknown> }).toJSON());

    let statesMap: Map<string, Record<string, number>> = new Map();
    if (cols.has('referralState')) {
      const stSql = `
        SELECT ${sn} AS siteNum,
               COALESCE(NULLIF(r.${ident('referralState')}, ''), 'UNKNOWN') AS state,
               COUNT(*)::BIGINT AS n
        FROM ${ident(tableName)} r
        ${where}
        GROUP BY siteNum, state
      `;
      const stRes = await conn.query(stSql);
      for (const row of stRes.toArray()) {
        const j = (row as { toJSON: () => { siteNum: string; state: string; n: number } }).toJSON();
        const k = String(j.siteNum ?? '');
        if (!statesMap.has(k)) statesMap.set(k, {});
        statesMap.get(k)![String(j.state ?? 'UNKNOWN')] = Number(j.n || 0);
      }
      // unused variable guard
      void stateExpr;
    }

    let listingsMap: Map<string, { ref: string; title: string; count: number }[]> = new Map();
    if (cols.has('referralTargetRef')) {
      const titleExpr = listingTitleJoinable
        ? `COALESCE(NULLIF(l.${ident('title')}, ''), ${cols.has('recipientName') ? `NULLIF(MIN(r.${ident('recipientName')}), ''),` : ''} r.${ident('referralTargetRef')})`
        : cols.has('recipientName')
          ? `COALESCE(NULLIF(MIN(r.${ident('recipientName')}), ''), r.${ident('referralTargetRef')})`
          : `r.${ident('referralTargetRef')}`;
      const joinL = listingTitleJoinable
        ? `LEFT JOIN ${ident('lookup_listings')} l ON l.${ident('ref')} = r.${ident('referralTargetRef')}`
        : '';
      const lSql = `
        SELECT ${sn} AS siteNum,
               r.${ident('referralTargetRef')} AS ref,
               ${titleExpr} AS title,
               COUNT(*)::BIGINT AS n
        FROM ${ident(tableName)} r ${joinL}
        ${where}${where ? ' AND ' : 'WHERE '}NULLIF(r.${ident('referralTargetRef')}, '') IS NOT NULL
        GROUP BY siteNum, r.${ident('referralTargetRef')}${listingTitleJoinable ? `, l.${ident('title')}` : ''}
      `;
      const lRes = await conn.query(lSql);
      for (const row of lRes.toArray()) {
        const j = (row as { toJSON: () => { siteNum: string; ref: string; title: string; n: number } }).toJSON();
        const k = String(j.siteNum ?? '');
        if (!listingsMap.has(k)) listingsMap.set(k, []);
        listingsMap.get(k)!.push({ ref: String(j.ref ?? ''), title: String(j.title ?? j.ref ?? ''), count: Number(j.n || 0) });
      }
      for (const arr of listingsMap.values()) arr.sort((a, b) => b.count - a.count);
    }

    byTarget = baseRows.map(row => {
      const siteNum = String(row.siteNum ?? '');
      return {
        siteNum,
        siteName: String(row.siteName ?? siteNum),
        totalRefs: Number(row.totalRefs || 0),
        uniqueSenders: Number(row.uniqueSenders || 0),
        states: statesMap.get(siteNum) || {},
        listings: listingsMap.get(siteNum) || [],
      };
    });
  }

  let bySource: import('@/types').SourceSiteRow[] | null = null;
  if (cols.has('srcsiteNum')) {
    const sn = siteNormExprCol(`r.${ident('srcsiteNum')}`);
    const joinS = siteNameJoinable
      ? `LEFT JOIN ${ident('lookup_sites')} s ON ${siteNormExprCol(`s.${ident('siteNumber')}`)} = ${sn}`
      : '';
    const nameExpr = siteNameJoinable
      ? `ANY_VALUE(s.${ident('siteName')})`
      : cols.has('srcSiteName')
        ? `ANY_VALUE(r.${ident('srcSiteName')})`
        : `ANY_VALUE(${sn})`;
    const targetExpr = cols.has('siteNum')
      ? `COUNT(DISTINCT ${siteNormExprCol(`r.${ident('siteNum')}`)})::BIGINT`
      : `0::BIGINT`;
    const userExpr = cols.has('referredByUserName')
      ? `COUNT(DISTINCT NULLIF(r.${ident('referredByUserName')}, ''))::BIGINT`
      : `0::BIGINT`;
    const sSql = `
      SELECT ${sn} AS siteNum,
             ${nameExpr} AS siteName,
             COUNT(*)::BIGINT AS totalRefs,
             ${targetExpr} AS uniqueTargets,
             ${userExpr} AS uniqueUsers
      FROM ${ident(tableName)} r ${joinS}
      ${where}${where ? ' AND ' : 'WHERE '}NULLIF(r.${ident('srcsiteNum')}, '') IS NOT NULL
      GROUP BY siteNum
      ORDER BY totalRefs DESC
    `;
    const sRes = await conn.query(sSql);
    bySource = sRes.toArray().map(r => {
      const j = (r as { toJSON: () => Record<string, unknown> }).toJSON();
      const siteNum = String(j.siteNum ?? '');
      return {
        siteNum,
        siteName: String(j.siteName ?? siteNum),
        totalRefs: Number(j.totalRefs || 0),
        uniqueTargets: Number(j.uniqueTargets || 0),
        uniqueUsers: Number(j.uniqueUsers || 0),
      };
    });
  }

  let bySender: import('@/types').SenderRow[] | null = null;
  if (cols.has('referredByUserName')) {
    const userNameExpr = `r.${ident('referredByUserName')}`;
    const fullNameExpr = cols.has('referredByUserFullName')
      ? `ANY_VALUE(NULLIF(r.${ident('referredByUserFullName')}, ''))`
      : userNameJoinable && userMetaCols.has('name')
        ? `ANY_VALUE(u.${ident('name')})`
        : `ANY_VALUE(${userNameExpr})`;
    const clinTypeExpr = cols.has('referrerClinicianType')
      ? `ANY_VALUE(NULLIF(r.${ident('referrerClinicianType')}, ''))`
      : userNameJoinable && userMetaCols.has('clinicianType')
        ? `ANY_VALUE(u.${ident('clinicianType')})`
        : `''`;
    const profExpr = cols.has('referrerProfessionalId')
      ? `ANY_VALUE(NULLIF(r.${ident('referrerProfessionalId')}, ''))`
      : `''`;
    const tgtRefExpr = cols.has('siteNum')
      ? `COUNT(DISTINCT ${siteNormExprCol(`r.${ident('siteNum')}`)})::BIGINT`
      : `0::BIGINT`;
    const listingExpr = cols.has('referralTargetRef')
      ? `COUNT(DISTINCT NULLIF(r.${ident('referralTargetRef')}, ''))::BIGINT`
      : `0::BIGINT`;
    const joinU = userNameJoinable
      ? `LEFT JOIN ${ident('lookup_users')} u ON u.${ident('userName')} = r.${ident('referredByUserName')}`
      : '';
    const senderSql = `
      SELECT ${userNameExpr} AS userName,
             ${fullNameExpr} AS fullName,
             ${clinTypeExpr} AS clinicianType,
             ${profExpr} AS profId,
             COUNT(*)::BIGINT AS totalRefs,
             ${tgtRefExpr} AS uniqueTargets,
             ${listingExpr} AS uniqueListings
      FROM ${ident(tableName)} r ${joinU}
      ${where}${where ? ' AND ' : 'WHERE '}NULLIF(r.${ident('referredByUserName')}, '') IS NOT NULL
      GROUP BY userName
      ORDER BY totalRefs DESC
    `;
    const senderRes = await conn.query(senderSql);
    const senderBase = senderRes.toArray().map(r => {
      const j = (r as { toJSON: () => Record<string, unknown> }).toJSON();
      return {
        userName: String(j.userName ?? ''),
        fullName: String(j.fullName ?? j.userName ?? ''),
        clinicianType: String(j.clinicianType ?? ''),
        profId: String(j.profId ?? ''),
        totalRefs: Number(j.totalRefs || 0),
        uniqueTargets: Number(j.uniqueTargets || 0),
        uniqueListings: Number(j.uniqueListings || 0),
      };
    });

    let srcSitesMap: Map<string, { siteNum: string; siteName: string; count: number }[]> = new Map();
    if (cols.has('srcsiteNum')) {
      const sn = siteNormExprCol(`r.${ident('srcsiteNum')}`);
      const nameExpr = siteNameJoinable
        ? `ANY_VALUE(s.${ident('siteName')})`
        : cols.has('srcSiteName')
          ? `ANY_VALUE(r.${ident('srcSiteName')})`
          : `ANY_VALUE(${sn})`;
      const joinS2 = siteNameJoinable
        ? `LEFT JOIN ${ident('lookup_sites')} s ON ${siteNormExprCol(`s.${ident('siteNumber')}`)} = ${sn}`
        : '';
      const srcSitesSql = `
        SELECT ${userNameExpr} AS userName, ${sn} AS siteNum, ${nameExpr} AS siteName, COUNT(*)::BIGINT AS n
        FROM ${ident(tableName)} r ${joinS2}
        ${where}${where ? ' AND ' : 'WHERE '}NULLIF(r.${ident('referredByUserName')}, '') IS NOT NULL AND NULLIF(r.${ident('srcsiteNum')}, '') IS NOT NULL
        GROUP BY userName, siteNum
      `;
      const srcRes = await conn.query(srcSitesSql);
      for (const row of srcRes.toArray()) {
        const j = (row as { toJSON: () => Record<string, unknown> }).toJSON();
        const u = String(j.userName ?? '');
        if (!srcSitesMap.has(u)) srcSitesMap.set(u, []);
        srcSitesMap.get(u)!.push({
          siteNum: String(j.siteNum ?? ''),
          siteName: String(j.siteName ?? j.siteNum ?? ''),
          count: Number(j.n || 0),
        });
      }
      for (const arr of srcSitesMap.values()) arr.sort((a, b) => b.count - a.count);
    }

    const senderRows: import('@/types').SenderRow[] = senderBase.map(b => ({
      userName: b.userName,
      fullName: b.fullName,
      clinicianType: b.clinicianType,
      profId: b.profId,
      totalRefs: b.totalRefs,
      uniqueTargets: b.uniqueTargets,
      uniqueListings: b.uniqueListings,
      isUnknown: false,
      srcSites: srcSitesMap.get(b.userName) || [],
    }));

    const unknownSql = `
      SELECT COUNT(*)::BIGINT AS total,
             ${cols.has('siteNum') ? `COUNT(DISTINCT ${siteNormExprCol(`r.${ident('siteNum')}`)})::BIGINT` : `0::BIGINT`} AS uniqueTargets,
             ${cols.has('referralTargetRef') ? `COUNT(DISTINCT NULLIF(r.${ident('referralTargetRef')}, ''))::BIGINT` : `0::BIGINT`} AS uniqueListings
      FROM ${ident(tableName)} r
      ${where}${where ? ' AND ' : 'WHERE '}NULLIF(r.${ident('referredByUserName')}, '') IS NULL
    `;
    const uRes = await conn.query(unknownSql);
    const uRow = uRes.toArray()[0] as { toJSON: () => Record<string, unknown> } | undefined;
    const unknownTotal = uRow ? Number(uRow.toJSON().total || 0) : 0;
    if (unknownTotal > 0) {
      let unknownSrcSites: { siteNum: string; siteName: string; count: number }[] = [];
      if (cols.has('srcsiteNum')) {
        const sn = siteNormExprCol(`r.${ident('srcsiteNum')}`);
        const nameExpr = siteNameJoinable
          ? `ANY_VALUE(s.${ident('siteName')})`
          : cols.has('srcSiteName')
            ? `ANY_VALUE(r.${ident('srcSiteName')})`
            : `ANY_VALUE(${sn})`;
        const joinS2 = siteNameJoinable
          ? `LEFT JOIN ${ident('lookup_sites')} s ON ${siteNormExprCol(`s.${ident('siteNumber')}`)} = ${sn}`
          : '';
        const uSrcSql = `
          SELECT ${sn} AS siteNum, ${nameExpr} AS siteName, COUNT(*)::BIGINT AS n
          FROM ${ident(tableName)} r ${joinS2}
          ${where}${where ? ' AND ' : 'WHERE '}NULLIF(r.${ident('referredByUserName')}, '') IS NULL AND NULLIF(r.${ident('srcsiteNum')}, '') IS NOT NULL
          GROUP BY siteNum
          ORDER BY n DESC
        `;
        const uSrcRes = await conn.query(uSrcSql);
        unknownSrcSites = uSrcRes.toArray().map(r => {
          const j = (r as { toJSON: () => Record<string, unknown> }).toJSON();
          return {
            siteNum: String(j.siteNum ?? ''),
            siteName: String(j.siteName ?? j.siteNum ?? ''),
            count: Number(j.n || 0),
          };
        });
      }
      const uJson = uRow!.toJSON();
      senderRows.unshift({
        userName: '',
        fullName: '(Unknown sender)',
        clinicianType: '',
        profId: '',
        totalRefs: unknownTotal,
        uniqueTargets: Number(uJson.uniqueTargets || 0),
        uniqueListings: Number(uJson.uniqueListings || 0),
        isUnknown: true,
        srcSites: unknownSrcSites,
      });
    }
    bySender = senderRows;
  }

  let fhirCount = 0;
  if (cols.has('referralSource')) {
    const res = await conn.query(
      `SELECT COUNT(*)::BIGINT AS n
       FROM ${ident(tableName)}
       WHERE UPPER(COALESCE(${ident('referralSource')}, '')) LIKE '%FHIR%' ${prefix}`,
    );
    const row = res.toArray()[0] as { toJSON: () => { n: number } } | undefined;
    fhirCount = row ? Number(row.toJSON().n || 0) : 0;
  }

  return {
    timeline,
    weekly,
    byRegion,
    byRaName,
    byService,
    byClinType,
    byEmrSent,
    byEmrRecv,
    fhirCount,
    earliestDate,
    byTarget,
    bySource,
    bySender,
  };
}

function emptyAnalytics(): ReferralAnalytics {
  return {
    total: 0,
    distinctRefs: 0,
    uniqueSendingSites: 0,
    uniqueTargetSites: 0,
    uniqueSenders: 0,
    uniqueProfIds: 0,
    uniqueTargetRefs: 0,
    distinctInitialTargetRefs: [],
    curMCount: 0,
    curM: '',
    lastFullM: '',
    lastFullCount: 0,
    chg1: { val: 'N/A', num: 0 },
    cmp1M: '',
    cmp1Count: 0,
    chg3: { val: 'N/A', num: 0 },
    cmp3M: '',
    cmp3Count: 0,
    chg12: { val: 'N/A', num: 0 },
    cmp12M: '',
    cmp12Count: 0,
    earliestDate: '',
    fhirCount: 0,
    fhirPct: 0,
    timeline: [],
    weekly: [],
    byTarget: [],
    bySource: [],
    bySender: [],
    byRegion: [],
    byRaName: [],
    byService: [],
    byClinType: [],
    byEmrSent: [],
    byEmrRecv: [],
  };
}

async function computeDistinctInitialTargetRefs(tableName: string): Promise<{ ref: string; title: string }[]> {
  const conn = await getConn();
  const colsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name=${sqlLit(tableName)}`,
  );
  const cols = new Set(
    colsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  if (!cols.has('initialReferralTargetRef')) return [];
  const listingColsRes = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='lookup_listings'`,
  );
  const listingCols = new Set(
    listingColsRes.toArray().map((r: unknown) => (r as { toJSON: () => { column_name: string } }).toJSON().column_name),
  );
  const joinable = listingCols.has('ref') && listingCols.has('title');
  const sql = joinable
    ? `SELECT DISTINCT r.${ident('initialReferralTargetRef')} AS ref,
              COALESCE(NULLIF(l.${ident('title')}, ''), r.${ident('initialReferralTargetRef')}) AS title
       FROM ${ident(tableName)} r
       LEFT JOIN ${ident('lookup_listings')} l ON l.${ident('ref')} = r.${ident('initialReferralTargetRef')}
       WHERE NULLIF(r.${ident('initialReferralTargetRef')}, '') IS NOT NULL
       ORDER BY ref`
    : `SELECT DISTINCT ${ident('initialReferralTargetRef')} AS ref, ${ident('initialReferralTargetRef')} AS title
       FROM ${ident(tableName)}
       WHERE NULLIF(${ident('initialReferralTargetRef')}, '') IS NOT NULL
       ORDER BY ref`;
  const res = await conn.query(sql);
  return res.toArray().map(r => {
    const j = (r as { toJSON: () => { ref: string; title: string } }).toJSON();
    return { ref: String(j.ref ?? ''), title: String(j.title ?? j.ref ?? '') };
  });
}

async function buildAnalyticsFromSql(
  tableName: string,
  whereClause: string,
  includeInitialRefs: boolean,
): Promise<ReferralAnalytics | null> {
  const kpis = await computeSqlKpis(tableName, whereClause);
  if (!kpis) return null;
  const agg = await computeSqlAggregates(tableName, whereClause);
  if (!agg) return null;
  const analytics = emptyAnalytics();
  analytics.total = kpis.total;
  analytics.distinctRefs = kpis.distinctRefs;
  analytics.uniqueSendingSites = kpis.uniqueSendingSites;
  analytics.uniqueTargetSites = kpis.uniqueTargetSites;
  analytics.uniqueSenders = kpis.uniqueSenders;
  analytics.uniqueProfIds = kpis.uniqueProfIds;
  analytics.uniqueTargetRefs = kpis.uniqueTargetRefs;
  applySqlAggregates(analytics, agg);
  if (includeInitialRefs) {
    analytics.distinctInitialTargetRefs = await computeDistinctInitialTargetRefs(tableName).catch(() => []);
  }
  return analytics;
}

function applySqlAggregates(analytics: ReferralAnalytics, agg: SqlAggregates): void {
  if (agg.timeline.length) {
    analytics.timeline = agg.timeline;
    const monthAt = (off: number) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + off);
      return d.toISOString().slice(0, 7);
    };
    const lookup = new Map(agg.timeline.map(t => [t.label, t.value]));
    const curM = monthAt(0);
    const lastFullM = monthAt(-1);
    const cmp1M = monthAt(-2);
    const cmp3M = monthAt(-4);
    const cmp12M = monthAt(-13);
    const curMCount = lookup.get(curM) || 0;
    const lastFullCount = lookup.get(lastFullM) || 0;
    const cmp1Count = lookup.get(cmp1M) || 0;
    const cmp3Count = lookup.get(cmp3M) || 0;
    const cmp12Count = lookup.get(cmp12M) || 0;
    const pctChg = (cur: number, prev: number) => {
      if (prev === 0) return { val: 'N/A', num: 0 };
      const num = Math.round(((cur - prev) / prev) * 1000) / 10;
      return { val: (num >= 0 ? '+' : '') + num + '%', num };
    };
    analytics.curM = curM;
    analytics.lastFullM = lastFullM;
    analytics.cmp1M = cmp1M;
    analytics.cmp3M = cmp3M;
    analytics.cmp12M = cmp12M;
    analytics.curMCount = curMCount;
    analytics.lastFullCount = lastFullCount;
    analytics.cmp1Count = cmp1Count;
    analytics.cmp3Count = cmp3Count;
    analytics.cmp12Count = cmp12Count;
    analytics.chg1 = pctChg(lastFullCount, cmp1Count);
    analytics.chg3 = pctChg(lastFullCount, cmp3Count);
    analytics.chg12 = pctChg(lastFullCount, cmp12Count);
  }
  if (agg.weekly.length) analytics.weekly = agg.weekly;
  if (agg.byRegion.length) analytics.byRegion = agg.byRegion;
  if (agg.byRaName.length) analytics.byRaName = agg.byRaName;
  if (agg.byService.length) analytics.byService = agg.byService;
  if (agg.byClinType.length) analytics.byClinType = agg.byClinType;
  if (agg.byEmrSent.length) analytics.byEmrSent = agg.byEmrSent;
  if (agg.byEmrRecv.length) analytics.byEmrRecv = agg.byEmrRecv;
  analytics.fhirCount = agg.fhirCount;
  analytics.fhirPct = analytics.total === 0 ? 0 : Math.round((agg.fhirCount / analytics.total) * 1000) / 10;
  if (agg.earliestDate) analytics.earliestDate = agg.earliestDate;
  if (agg.byTarget) analytics.byTarget = agg.byTarget;
  if (agg.bySource) analytics.bySource = agg.bySource;
  if (agg.bySender) analytics.bySender = agg.bySender;
}

const noFilters = (includeTest: boolean, regionRefs: string[], initialTargetRefs: string[] | undefined, raNames: string[] | undefined) =>
  includeTest && regionRefs.length === 0 && (!initialTargetRefs || !initialTargetRefs.length) && (!raNames || !raNames.length);

const processCsvStreaming = async (
  requestId: number,
  file: File,
  map: Record<string, string>,
  storageKey: string,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
  ingestRoute: 'auto' | 'small' | 'large',
) => {
  const ingestStart = performance.now();
  postTelemetry(requestId, 'parse_start', {
    parser: 'csv-stream',
    fileSize: file.size,
    fileName: file.name,
  });
  postProgress(requestId, 0, file.size, 'Ingesting CSV into DuckDB...');
  await rowStore.open(storageKey);
  await rowStore.clear(storageKey);
  cachedStorageKey = storageKey;
  baseAnalytics = null;

  await timed(requestId, 'csv_ingest', () => rowStore.ingestCsvFile(file, map), { fileSize: file.size });
  await timed(requestId, 'lookup_register', () => registerLookupTables({ sites, listings, users }));
  postProgress(requestId, Math.floor(file.size * 0.6), file.size, 'Normalizing data...');

  const table = rowStore.getTableName();
  const columns = rowStore.getColumns();
  const conn = await getConn();

  if (columns.includes('referralCreationDate')) {
    await conn.query(
      `UPDATE ${ident(table)} SET ${ident('referralCreationDate')} = COALESCE(TRY_STRFTIME(TRY_CAST(${ident('referralCreationDate')} AS TIMESTAMP), '%Y-%m-%d'), ${ident('referralCreationDate')})`
    );
  }

  const required = ['referralCreationDate', 'referralRef', 'referralTargetRef'].filter(k => columns.includes(k));
  let missingRequiredRows = 0;
  let invalidDateRows = 0;

  if (required.length) {
    const missingClause = required.map(k => `(${ident(k)} IS NULL OR ${ident(k)} = '')`).join(' OR ');
    const res = await conn.query(`SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)} WHERE ${missingClause}`);
    missingRequiredRows = Number((res.toArray()[0] as { toJSON: () => { n: number } }).toJSON().n || 0);
    if (missingRequiredRows > 0) {
      await conn.query(`DELETE FROM ${ident(table)} WHERE ${missingClause}`);
    }
  }

  if (columns.includes('referralCreationDate')) {
    const res = await conn.query(
      `SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)} WHERE NOT regexp_matches(${ident('referralCreationDate')}, '^\\d{4}-\\d{2}-\\d{2}$')`
    );
    invalidDateRows = Number((res.toArray()[0] as { toJSON: () => { n: number } }).toJSON().n || 0);
  }

  const cntRes = await conn.query(`SELECT COUNT(*)::BIGINT AS n FROM ${ident(table)}`);
  const acceptedRows = Number((cntRes.toArray()[0] as { toJSON: () => { n: number } }).toJSON().n || 0);
  (rowStore as unknown as { rowCount: number }).rowCount = acceptedRows;

  postProgress(requestId, Math.floor(file.size * 0.8), file.size, 'Computing analytics...');
  let analytics = await timed(requestId, 'analytics_sql', () => buildAnalyticsFromSql(table, '', true), {
    scope: 'ingest',
  }).catch(() => null);
  if (!analytics) {
    postTelemetry(requestId, 'analytics_fallback', { path: 'js-accumulator' });
    analytics = await timed(requestId, 'analytics_js', async () => {
      const acc = new ReferralAnalyticsAccumulator({ sites, listings, users });
      for await (const batch of rowStore.streamRead(50000)) {
        for (const row of batch) acc.add(row);
      }
      const a = acc.finalize();
      const sqlKpis = await computeSqlKpis(table, '').catch(() => null);
      if (sqlKpis) {
        a.total = sqlKpis.total;
        a.distinctRefs = sqlKpis.distinctRefs;
        a.uniqueSendingSites = sqlKpis.uniqueSendingSites;
        a.uniqueTargetSites = sqlKpis.uniqueTargetSites;
        a.uniqueSenders = sqlKpis.uniqueSenders;
        a.uniqueProfIds = sqlKpis.uniqueProfIds;
        a.uniqueTargetRefs = sqlKpis.uniqueTargetRefs;
      }
      const sqlAgg = await computeSqlAggregates(table, '').catch(() => null);
      if (sqlAgg) applySqlAggregates(a, sqlAgg);
      return a;
    });
  }
  baseAnalytics = analytics;

  const sampleRes = await conn.query(`SELECT * FROM ${ident(table)} LIMIT 1`);
  const sampleRow = sampleRes.toArray()[0] as { toJSON: () => Record<string, unknown> } | undefined;
  const sample = sampleRow ? sampleRow.toJSON() : {};
  const headerDiag: HeaderDiag[] = columns.map(c => ({
    raw: c,
    mapped: c,
    inMap: true,
    sample: normalize(sample[c]).slice(0, 60),
  }));

  postProgress(requestId, file.size, file.size, 'Completed');
  postTelemetry(requestId, 'parse_complete', {
    parser: 'csv-stream',
    acceptedRows,
    missingRequiredRows,
    invalidDateRows,
    totalElapsedMs: Math.round(performance.now() - ingestStart),
    rowsPerSec: acceptedRows > 0
      ? Math.round(acceptedRows / Math.max(0.001, (performance.now() - ingestStart) / 1000))
      : 0,
  });
  self.postMessage({
    type: 'complete',
    requestId,
    headerDiag,
    analytics,
    metadata: {
      parser: 'csv-stream',
      ingestRoute,
      rowCount: acceptedRows,
      fileName: file.name,
      fileSize: file.size,
      storageEngine: 'opfs',
      storageKey,
      diagnostics: {
        sourceRows: acceptedRows + missingRequiredRows,
        acceptedRows,
        omittedRows: missingRequiredRows,
        mismatchedRows: 0,
        missingRequiredRows,
        invalidDateRows,
        omittedSamples: [],
      },
      paritySignature: `${analytics.total}|${analytics.distinctRefs}|${analytics.timeline.length}|${analytics.weekly.length}`,
    },
  });
};

const processXlsxSmall = async (
  requestId: number,
  buffer: ArrayBuffer,
  map: Record<string, string>,
  fileName: string,
  fileSize: number,
  storageKey: string,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
  ingestRoute: 'auto' | 'small' | 'large',
) => {
  const ingestStart = performance.now();
  postTelemetry(requestId, 'parse_start', { parser: 'xlsx-worker', fileSize, fileName });
  await rowStore.open(storageKey);
  await rowStore.clear(storageKey);
  cachedStorageKey = storageKey;
  baseAnalytics = null;

  postProgress(requestId, 0, 100, 'Reading workbook...');
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  postProgress(requestId, 35, 100, 'Converting sheet to rows...');
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headerDiag: HeaderDiag[] = [];
  if (raw.length > 0) {
    for (const k of Object.keys(raw[0])) {
      headerDiag.push({
        raw: k,
        mapped: mapHeader(k, map),
        inMap: !!(map[k] || map[k.toLowerCase()]),
        sample: normalize(raw[0][k]).slice(0, 60),
      });
    }
  }
  postProgress(requestId, 55, 100, 'Mapping fields...');
  const mapped: Record<string, string>[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const src = raw[i];
    const out: Record<string, string> = {};
    for (const k in src) out[mapHeader(k, map)] = normalize(src[k]);
    if (out.referralCreationDate) out.referralCreationDate = formatDate(out.referralCreationDate) || out.referralCreationDate;
    mapped[i] = out;
  }

  postProgress(requestId, 75, 100, 'Storing rows in DuckDB...');
  await rowStore.createFromRows(mapped);
  await registerLookupTables({ sites, listings, users });

  postProgress(requestId, 90, 100, 'Computing analytics...');
  let analytics = await timed(requestId, 'analytics_sql', () => buildAnalyticsFromSql(rowStore.getTableName(), '', true), {
    scope: 'ingest-xlsx',
  }).catch(() => null);
  if (!analytics) {
    postTelemetry(requestId, 'analytics_fallback', { path: 'js-accumulator' });
    analytics = await timed(requestId, 'analytics_js', async () => {
      const acc = new ReferralAnalyticsAccumulator({ sites, listings, users });
      for (const row of mapped) acc.add(row);
      return acc.finalize();
    });
  }
  baseAnalytics = analytics;

  postProgress(requestId, 100, 100, 'Completed');
  postTelemetry(requestId, 'parse_complete', {
    parser: 'xlsx-worker',
    acceptedRows: rowStore.getRowCount(),
    totalElapsedMs: Math.round(performance.now() - ingestStart),
    rowsPerSec: rowStore.getRowCount() > 0
      ? Math.round(rowStore.getRowCount() / Math.max(0.001, (performance.now() - ingestStart) / 1000))
      : 0,
  });
  self.postMessage({
    type: 'complete',
    requestId,
    headerDiag,
    analytics,
    metadata: {
      parser: 'xlsx-worker',
      ingestRoute,
      rowCount: rowStore.getRowCount(),
      fileName,
      fileSize,
      storageEngine: 'opfs',
      storageKey,
      diagnostics: {
        sourceRows: raw.length,
        acceptedRows: rowStore.getRowCount(),
        omittedRows: 0,
        mismatchedRows: 0,
        missingRequiredRows: 0,
        invalidDateRows: 0,
      },
    },
  });
};

const filterFromStore = async (
  requestId: number,
  storageKey: string,
  includeTest: boolean,
  regionRefs: string[] = [],
  initialTargetRefs: string[] | undefined,
  raNames: string[] | undefined,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
) => {
  const ctx: Ctx = { sites, listings, users };
  const noFilter = noFilters(includeTest, regionRefs, initialTargetRefs, raNames);
  const recomputeStart = performance.now();
  postTelemetry(requestId, 'recompute_start', {
    includeTest,
    regionCount: regionRefs.length,
    initialTargetCount: initialTargetRefs?.length || 0,
    raNameCount: raNames?.length || 0,
    noFilter,
  });

  if (noFilter && baseAnalytics && cachedStorageKey === storageKey) {
    postTelemetry(requestId, 'recompute_complete', {
      path: 'cached-base',
      totalElapsedMs: Math.round(performance.now() - recomputeStart),
    });
    self.postMessage({ type: 'filtered', requestId, analytics: baseAnalytics });
    return;
  }

  await rowStore.open(storageKey);
  cachedStorageKey = storageKey;

  const columns = new Set(rowStore.getColumns());
  const clauses: string[] = [];

  if (!includeTest && columns.has('sentToTestListing')) {
    clauses.push(`(${ident('sentToTestListing')} IS NULL OR ${ident('sentToTestListing')} <> 'TRUE')`);
  }
  if (regionRefs.length && columns.has('referralTargetRef')) {
    const list = regionRefs.map(sqlLit).join(',');
    clauses.push(`${ident('referralTargetRef')} IN (${list})`);
  }
  if (initialTargetRefs?.length && columns.has('initialReferralTargetRef')) {
    const list = initialTargetRefs.map(sqlLit).join(',');
    clauses.push(`${ident('initialReferralTargetRef')} IN (${list})`);
  }
  if (raNames?.length && columns.has('raName')) {
    const list = raNames.map(sqlLit).join(',');
    clauses.push(`${ident('raName')} IN (${list})`);
  }

  const whereClause = clauses.join(' AND ');
  let analytics = await timed(requestId, 'recompute_sql', () => buildAnalyticsFromSql(rowStore.getTableName(), whereClause, false)).catch(() => null);
  if (!analytics) {
    postTelemetry(requestId, 'recompute_fallback', { path: 'js-accumulator' });
    const acc = new ReferralAnalyticsAccumulator(ctx);
    const iterator = await rowStore.streamReadFiltered(50000, whereClause);
    for await (const batch of iterator) {
      for (const row of batch) acc.add(row);
    }
    analytics = acc.finalize();
    const filteredKpis = await computeSqlKpis(rowStore.getTableName(), whereClause).catch(() => null);
    if (filteredKpis) {
      analytics.total = filteredKpis.total;
      analytics.distinctRefs = filteredKpis.distinctRefs;
      analytics.uniqueSendingSites = filteredKpis.uniqueSendingSites;
      analytics.uniqueTargetSites = filteredKpis.uniqueTargetSites;
      analytics.uniqueSenders = filteredKpis.uniqueSenders;
      analytics.uniqueProfIds = filteredKpis.uniqueProfIds;
      analytics.uniqueTargetRefs = filteredKpis.uniqueTargetRefs;
    }
    const filteredAgg = await computeSqlAggregates(rowStore.getTableName(), whereClause).catch(() => null);
    if (filteredAgg) applySqlAggregates(analytics, filteredAgg);
  }
  if (baseAnalytics && !analytics.distinctInitialTargetRefs.length) {
    analytics.distinctInitialTargetRefs = baseAnalytics.distinctInitialTargetRefs;
  }
  if (noFilter) baseAnalytics = analytics;
  postTelemetry(requestId, 'recompute_complete', {
    path: 'sql',
    total: analytics.total,
    totalElapsedMs: Math.round(performance.now() - recomputeStart),
  });
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
      await processXlsxSmall(msg.requestId, msg.buffer, msg.map, msg.fileName, msg.fileSize, msg.storageKey, msg.sites, msg.listings, msg.users, msg.ingestRoute);
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
