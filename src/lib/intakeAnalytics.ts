import type {
  IntakeAnalytics,
  IntakeBacklogStateRow,
  IntakeMonthBucket,
  IntakeRecipientStat,
  IntakeView,
} from '@/types';

// Ontario fiscal year starts April 1. FY2025-26 = Apr 1 2025 → Mar 31 2026.
export function computeFiscalYear(isoDate: string): string {
  const y = parseInt(isoDate.slice(0, 4), 10);
  const m = parseInt(isoDate.slice(5, 7), 10);
  const start = m >= 4 ? y : y - 1;
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function computeQuarter(isoDate: string): string {
  const m = parseInt(isoDate.slice(5, 7), 10);
  let q: string;
  if (m >= 4 && m <= 6) q = 'Q1';
  else if (m >= 7 && m <= 9) q = 'Q2';
  else if (m >= 10 && m <= 12) q = 'Q3';
  else q = 'Q4';
  return `${computeFiscalYear(isoDate)} ${q}`;
}

// ISO 8601 week with Monday as the first day. Mirrors the algorithm at
// referralAnalyticsAccumulator.ts so monthly bucket weeks align with the
// existing weekly chart.
export function computeISOWeek(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '';
  const d = new Date(isoDate.slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().slice(0, 10);
}

export function diffDays(laterIso: string, earlierIso: string): number | null {
  if (!laterIso || !earlierIso) return null;
  const a = new Date(laterIso);
  const b = new Date(earlierIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return (a.getTime() - b.getTime()) / 86400000;
}

export function parseNumeric(v: string | undefined | null): number | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

export function parseBool(v: string | undefined | null): boolean | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return null;
}

export function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

// PERCENTILE.INC (linear interpolation). p in [0, 100].
export function percentile(arr: number[], p: number): number | null {
  if (!arr.length) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

const PREF_CANON = {
  specific: 'Specific Surgeon',
  first: 'First Available Surgeon',
  closest: 'Surgeon Closest to Patient Home',
} as const;

export function normalizePatientPref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('specif')) return PREF_CANON.specific;
  if (s.includes('first')) return PREF_CANON.first;
  if (s.includes('clos')) return PREF_CANON.closest;
  return raw;
}

export function fmtMonthLabel(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(ym.slice(5, 7), 10);
  return `${monthNames[m - 1]} ${ym.slice(0, 4)}`;
}

interface MergeFilter {
  fy?: string;
  quarter?: string;
  month?: string;
  week?: string;
}

// Resolve which month keys match the active filter (Year ▸ Quarter ▸ Month ▸ Week cascade).
function resolveMonthKeys(intake: IntakeAnalytics, filter: MergeFilter): Set<string> {
  const all = Object.keys(intake.byMonth);
  if (filter.week) {
    const wk = intake.byWeek[filter.week];
    return new Set(wk ? [wk.month] : []);
  }
  if (filter.month) return new Set([filter.month]);
  if (filter.quarter) return new Set(intake.monthsByQuarter[filter.quarter] || []);
  if (filter.fy) {
    const qs = intake.quartersByFy[filter.fy] || [];
    const months: string[] = [];
    for (const q of qs) months.push(...(intake.monthsByQuarter[q] || []));
    return new Set(months);
  }
  return new Set(all);
}

export function mergeMonthBuckets(intake: IntakeAnalytics, filter: MergeFilter): IntakeView {
  const monthKeys = resolveMonthKeys(intake, filter);
  const buckets: IntakeMonthBucket[] = [];
  for (const k of monthKeys) {
    const b = intake.byMonth[k];
    if (b) buckets.push(b);
  }
  buckets.sort((a, b) => a.month.localeCompare(b.month));

  const wantWeekFilter = !!filter.week;
  const includeRow = (rowMonth: string): boolean => {
    if (!wantWeekFilter) return true;
    return intake.byWeek[filter.week!]?.month === rowMonth;
  };

  let totalProcessed = 0;
  const patientIds = new Set<string>();
  let completeCount = 0;
  let incompleteCount = 0;
  let cycleSum = 0;
  let cycleCount = 0;
  const cycleAll: number[] = [];
  const openAll: { initialCreationIso: string; referralState: string }[] = [];
  const wait1All: number[] = [];
  const wait2All: number[] = [];
  const patientPref: Record<string, number> = {};
  const recipientAgg: Record<string, { count: number; w1: number[]; w2: number[] }> = {};
  const referrerCounts: Record<string, number> = {};
  const sentTypeAgg: Record<string, { count: number; refs: Set<string> }> = {};
  const recipientLocation: Record<string, number> = {};
  const volumeByMonth: { label: string; value: number }[] = [];

  for (const b of buckets) {
    if (!includeRow(b.month)) continue;
    totalProcessed += b.total;
    for (const pid of b.patientIds) patientIds.add(pid);
    completeCount += b.completeCount;
    incompleteCount += b.incompleteCount;
    for (const c of b.cycleDays) {
      cycleSum += c;
      cycleCount++;
      cycleAll.push(c);
    }
    for (const e of b.openEntries) {
      openAll.push({ initialCreationIso: e.initialCreationIso, referralState: e.referralState });
    }
    for (const w of b.wait1Days) wait1All.push(w);
    for (const w of b.wait2Days) wait2All.push(w);
    for (const [k, v] of Object.entries(b.patientPref)) patientPref[k] = (patientPref[k] || 0) + v;
    for (const [k, r] of Object.entries(b.byRecipient)) {
      if (!recipientAgg[k]) recipientAgg[k] = { count: 0, w1: [], w2: [] };
      recipientAgg[k].count += r.count;
      for (const w of r.wait1Days) recipientAgg[k].w1.push(w);
      for (const w of r.wait2Days) recipientAgg[k].w2.push(w);
      recipientLocation[k] = (recipientLocation[k] || 0) + r.count;
    }
    for (const [k, v] of Object.entries(b.byReferrer)) referrerCounts[k] = (referrerCounts[k] || 0) + v;
    for (const [k, st] of Object.entries(b.bySentType)) {
      if (!sentTypeAgg[k]) sentTypeAgg[k] = { count: 0, refs: new Set() };
      sentTypeAgg[k].count += st.count;
      for (const r of st.referrers) sentTypeAgg[k].refs.add(r);
    }
    volumeByMonth.push({ label: fmtMonthLabel(b.month), value: b.total });
  }

  const recipientStats: IntakeRecipientStat[] = Object.entries(recipientAgg)
    .map(([recipientName, r]) => ({
      recipientName,
      count: r.count,
      avgWait1: mean(r.w1),
      p90Wait1: percentile(r.w1, 90),
      avgWait2: mean(r.w2),
      p90Wait2: percentile(r.w2, 90),
    }))
    .sort((a, b) => a.recipientName.localeCompare(b.recipientName));

  const totalForPct = Object.values(sentTypeAgg).reduce((s, x) => s + x.count, 0);
  const methodBySender = Object.entries(sentTypeAgg)
    .map(([method, x]) => ({
      method,
      count: x.count,
      pct: totalForPct > 0 ? x.count / totalForPct : 0,
      referrerCount: x.refs.size,
    }))
    .sort((a, b) => b.count - a.count);

  const currentLocation = Object.entries(recipientLocation)
    .map(([recipientName, count]) => ({ recipientName, count }))
    .sort((a, b) => b.count - a.count);

  const referrerCountsRows = Object.entries(referrerCounts)
    .map(([name, count]) => ({
      name,
      count,
      display: count < 5 ? '< 5 referrals' : String(count),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const referenceIso = intake.latestDate;
  const allOpenDays = referenceIso
    ? openAll
        .map(e => diffDays(referenceIso, e.initialCreationIso))
        .filter((d): d is number => d !== null && d >= 0)
    : [];

  const bucketDefs = [
    { label: '0–3', test: (d: number) => d <= 3 },
    { label: '4–7', test: (d: number) => d > 3 && d <= 7 },
    { label: '8–14', test: (d: number) => d > 7 && d <= 14 },
    { label: '15–30', test: (d: number) => d > 14 && d <= 30 },
    { label: '30+', test: (d: number) => d > 30 },
  ];
  const backlogHistogram = bucketDefs.map(bd => ({
    label: bd.label,
    value: allOpenDays.filter(bd.test).length,
  }));

  const stateAgg = new Map<string, number[]>();
  for (const e of openAll) {
    const d = referenceIso ? diffDays(referenceIso, e.initialCreationIso) : null;
    if (d === null || d < 0) continue;
    const k = e.referralState || 'UNKNOWN';
    if (!stateAgg.has(k)) stateAgg.set(k, []);
    stateAgg.get(k)!.push(d);
  }
  const backlogByState: IntakeBacklogStateRow[] = [...stateAgg.entries()]
    .map(([referralState, arr]) => ({ referralState, count: arr.length, avgDays: mean(arr) }))
    .sort((a, b) => b.count - a.count);

  const backlogPresent = intake.presence.backlog;
  const ciPresent = intake.presence.ciProcessing;

  return {
    totalProcessed,
    uniquePatients: intake.presence.patientId ? patientIds.size : null,
    avgCycleDays: intake.presence.cycle && cycleCount > 0 ? cycleSum / cycleCount : null,
    ciProcessingMedian: ciPresent ? percentile(cycleAll, 50) : null,
    ciProcessingP75: ciPresent ? percentile(cycleAll, 75) : null,
    ciProcessingP90: ciPresent ? percentile(cycleAll, 90) : null,
    ciProcessingCount: cycleAll.length,
    backlogCount: backlogPresent ? allOpenDays.length : 0,
    backlogAvgDays: backlogPresent ? mean(allOpenDays) : null,
    backlogHistogram: backlogPresent ? backlogHistogram : [],
    backlogByState: backlogPresent ? backlogByState : [],
    backlogReferenceDate: backlogPresent ? referenceIso || '' : '',
    wait1Count: wait1All.length,
    wait2Count: wait2All.length,
    avgWait1: mean(wait1All),
    p90Wait1: percentile(wait1All, 90),
    avgWait2: mean(wait2All),
    p90Wait2: percentile(wait2All, 90),
    completeCount,
    incompleteCount,
    patientPref,
    recipientStats,
    volumeByMonth,
    methodBySender,
    currentLocation,
    referrerCounts: referrerCountsRows,
  };
}
