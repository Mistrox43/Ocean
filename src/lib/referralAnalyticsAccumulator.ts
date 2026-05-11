import { formatDate, normalizeSiteNumber, percentage } from '@/utils';
import type {
  IntakeAnalytics,
  IntakeFieldPresence,
  IntakeMonthBucket,
  IntakeRecipientBucket,
  IntakeSentTypeBucket,
  ReferralAnalytics,
} from '@/types';
import {
  computeFiscalYear,
  computeISOWeek,
  computeQuarter,
  diffDays,
  normalizePatientPref,
  parseBool,
  parseNumeric,
} from './intakeAnalytics';

type Row = Record<string, string>;
type Ctx = { sites: Row[] | null; listings: Row[] | null; users: Row[] | null };

interface IntakeRecipientWork {
  count: number;
  wait1Days: number[];
  wait2Days: number[];
}

interface IntakeSentTypeWork {
  count: number;
  referrers: Set<string>;
}

interface IntakeMonthWork {
  month: string;
  fiscalYear: string;
  quarter: string;
  isoWeeks: Set<string>;
  total: number;
  patientIds: Set<string>;
  wait1Days: number[];
  wait2Days: number[];
  cycleDays: number[];
  completeCount: number;
  incompleteCount: number;
  patientPref: Record<string, number>;
  byRecipient: Record<string, IntakeRecipientWork>;
  byReferrer: Record<string, number>;
  bySentType: Record<string, IntakeSentTypeWork>;
}

export interface AccumulatorOutput {
  referral: ReferralAnalytics;
  intake: IntakeAnalytics;
}

export class ReferralAnalyticsAccumulator {
  private siteNameLookup: Record<string, string> = {};
  private siteEmrLookup: Record<string, string> = {};
  private listingTitleLookup: Record<string, string> = {};
  private userNameLookup: Record<string, { name: string; clinicianType: string }> = {};
  private regionLookup: Record<string, string> = {};

  private totalRows = 0;
  private distinctRefs = new Set<string>();
  private uniqueSendingSites = new Set<string>();
  private uniqueTargetSites = new Set<string>();
  private uniqueSenders = new Set<string>();
  private uniqueProfIds = new Set<string>();
  private uniqueTargetRefs = new Set<string>();
  private monthly: Record<string, number> = {};
  private earliestDate = '';

  private weekly: Record<string, { total: number; test: number; nonTest: number; senders: Set<string>; receivers: Set<string> }> = {};
  private byTarget: Record<string, { siteName: string; totalRefs: number; senders: Set<string>; states: Record<string, number>; listings: Record<string, { title: string; count: number }> }> = {};
  private bySource: Record<string, { siteName: string; totalRefs: number; targets: Set<string>; users: Set<string> }> = {};
  private bySender: Record<string, { fullName: string; clinicianType: string; profId: string; totalRefs: number; targets: Set<string>; targetListings: Set<string>; srcSites: Record<string, { name: string; count: number }> }> = {};
  private unknownSenderCount = 0;
  private unknownTargets = new Set<string>();
  private unknownListings = new Set<string>();
  private unknownSrcSites: Record<string, { name: string; count: number }> = {};

  private initialTargetRefs = new Map<string, string>();
  private regionMap: Record<string, number> = {};
  private raNameMap: Record<string, number> = {};
  private serviceMap: Record<string, number> = {};
  private clinTypeMap: Record<string, number> = {};
  private emrSent: Record<string, number> = {};
  private emrRecv: Record<string, number> = {};
  private sourceTypeMap: Record<string, number> = {};

  // Central Intake aggregation
  private intakeMonths: Record<string, IntakeMonthWork> = {};
  private intakeWeeks: Record<string, { count: number; month: string }> = {};
  private intakeUniquePatients = new Set<string>();
  private intakeProcessed = 0;
  private intakeCompleteCount = 0;
  private intakeIncompleteCount = 0;
  private intakeCycleSum = 0;
  private intakeCycleCount = 0;
  private intakeWait1Count = 0;
  private intakeWait2Count = 0;
  private intakeMinDate = '';
  private intakeMaxDate = '';
  private presence: IntakeFieldPresence = {
    patientId: false,
    wait1: false,
    wait2: false,
    cycle: false,
    preference: false,
    complete: false,
    referrer: false,
    source: false,
    recipient: false,
  };

  constructor(ctx: Ctx) {
    if (ctx.sites) ctx.sites.forEach(s => { const k = normalizeSiteNumber(s.siteNumber); this.siteNameLookup[k] = s.siteName; this.siteEmrLookup[k] = s.emr || ''; });
    if (ctx.listings) ctx.listings.forEach(l => { if (l.ref) { this.listingTitleLookup[l.ref] = l.title || 'Untitled'; this.regionLookup[l.ref] = l.healthRegion || ''; } });
    if (ctx.users) ctx.users.forEach(u => { if (u.userName) this.userNameLookup[u.userName] = { name: u.name || '', clinicianType: u.clinicianType || '' }; });
  }

  add(row: Row) {
    this.totalRows++;
    if (row.referralRef) this.distinctRefs.add(row.referralRef);
    const srcSite = normalizeSiteNumber(row.srcsiteNum);
    const tgtSite = normalizeSiteNumber(row.siteNum);
    if (srcSite) this.uniqueSendingSites.add(srcSite);
    if (tgtSite) this.uniqueTargetSites.add(tgtSite);
    if (row.referredByUserName) this.uniqueSenders.add(row.referredByUserName);
    if (row.referrerProfessionalId) this.uniqueProfIds.add(row.referrerProfessionalId);
    if (row.referralTargetRef) this.uniqueTargetRefs.add(row.referralTargetRef);
    const iRef = row.initialReferralTargetRef || '';
    if (iRef && !this.initialTargetRefs.has(iRef)) this.initialTargetRefs.set(iRef, this.listingTitleLookup[iRef] || iRef);

    const fd = formatDate(row.referralCreationDate);
    if (fd && fd.length >= 7) {
      const m = fd.substring(0, 7);
      this.monthly[m] = (this.monthly[m] || 0) + 1;
    }
    if (fd && /^\d{4}-\d{2}-\d{2}$/.test(fd) && (!this.earliestDate || fd < this.earliestDate)) this.earliestDate = fd;

    if (fd && /^\d{4}-\d{2}-\d{2}$/.test(fd)) {
      const d = new Date(fd.substring(0, 10) + 'T00:00:00Z');
      if (!isNaN(d.getTime())) {
        const day = d.getUTCDay(); const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        d.setUTCDate(diff); const wkKey = d.toISOString().slice(0, 10);
        if (!this.weekly[wkKey]) this.weekly[wkKey] = { total: 0, test: 0, nonTest: 0, senders: new Set(), receivers: new Set() };
        this.weekly[wkKey].total++;
        const isTest = row.sentToTestListing === 'TRUE';
        if (isTest) this.weekly[wkKey].test++; else this.weekly[wkKey].nonTest++;
        if (!isTest) { if (row.referrerProfessionalId) this.weekly[wkKey].senders.add(row.referrerProfessionalId); if (row.referralTargetRef) this.weekly[wkKey].receivers.add(row.referralTargetRef); }
      }
    }

    if (!this.byTarget[tgtSite]) this.byTarget[tgtSite] = { siteName: this.siteNameLookup[tgtSite] || row.recipientName || tgtSite, totalRefs: 0, senders: new Set(), states: {}, listings: {} };
    this.byTarget[tgtSite].totalRefs++;
    if (row.referredByUserName) this.byTarget[tgtSite].senders.add(row.referredByUserName);
    const st = row.referralState || 'UNKNOWN'; this.byTarget[tgtSite].states[st] = (this.byTarget[tgtSite].states[st] || 0) + 1;
    const lref = row.referralTargetRef || '';
    if (lref) { if (!this.byTarget[tgtSite].listings[lref]) this.byTarget[tgtSite].listings[lref] = { title: this.listingTitleLookup[lref] || row.recipientName || lref, count: 0 }; this.byTarget[tgtSite].listings[lref].count++; }

    if (srcSite) {
      if (!this.bySource[srcSite]) this.bySource[srcSite] = { siteName: this.siteNameLookup[srcSite] || row.srcSiteName || srcSite, totalRefs: 0, targets: new Set(), users: new Set() };
      this.bySource[srcSite].totalRefs++; this.bySource[srcSite].targets.add(tgtSite); if (row.referredByUserName) this.bySource[srcSite].users.add(row.referredByUserName);
    }

    const un = row.referredByUserName || '';
    const srcName = this.siteNameLookup[srcSite] || row.srcSiteName || srcSite || 'Unknown';
    if (!un) {
      this.unknownSenderCount++;
      this.unknownTargets.add(tgtSite);
      if (row.referralTargetRef) this.unknownListings.add(row.referralTargetRef);
      if (srcSite) { if (!this.unknownSrcSites[srcSite]) this.unknownSrcSites[srcSite] = { name: srcName, count: 0 }; this.unknownSrcSites[srcSite].count++; }
    } else {
      if (!this.bySender[un]) this.bySender[un] = { fullName: row.referredByUserFullName || this.userNameLookup[un]?.name || un, clinicianType: row.referrerClinicianType || this.userNameLookup[un]?.clinicianType || '', profId: row.referrerProfessionalId || '', totalRefs: 0, targets: new Set(), targetListings: new Set(), srcSites: {} };
      this.bySender[un].totalRefs++; this.bySender[un].targets.add(tgtSite); if (row.referralTargetRef) this.bySender[un].targetListings.add(row.referralTargetRef);
      if (!this.bySender[un].profId && row.referrerProfessionalId) this.bySender[un].profId = row.referrerProfessionalId;
      if (srcSite) { if (!this.bySender[un].srcSites[srcSite]) this.bySender[un].srcSites[srcSite] = { name: srcName, count: 0 }; this.bySender[un].srcSites[srcSite].count++; }
    }

    const tRef = row.referralTargetRef || '';
    let region = 'Referrals not mapped to listings';
    if (tRef && (tRef in this.regionLookup)) region = this.regionLookup[tRef] || 'Region not defined';
    this.regionMap[region] = (this.regionMap[region] || 0) + 1;
    const rn = row.raName || 'Unknown'; this.raNameMap[rn] = (this.raNameMap[rn] || 0) + 1;
    const svc = row.currentHealthService || row.initialHealthService || 'Unknown'; this.serviceMap[svc] = (this.serviceMap[svc] || 0) + 1;
    const ct = row.referrerClinicianType || 'Unknown'; this.clinTypeMap[ct] = (this.clinTypeMap[ct] || 0) + 1;
    const srcEmr = this.siteEmrLookup[srcSite] || 'Unknown EMR'; const tgtEmr = this.siteEmrLookup[tgtSite] || 'Unknown EMR';
    this.emrSent[srcEmr] = (this.emrSent[srcEmr] || 0) + 1; this.emrRecv[tgtEmr] = (this.emrRecv[tgtEmr] || 0) + 1;
    const srcType = row.referralSource || 'Unknown'; this.sourceTypeMap[srcType] = (this.sourceTypeMap[srcType] || 0) + 1;

    this.accumulateIntake(row, fd);
  }

  private accumulateIntake(row: Row, creationIso: string) {
    if (parseBool(row.referralDeleted) === true) return;
    if (!creationIso || !/^\d{4}-\d{2}-\d{2}$/.test(creationIso)) return;

    if (row.patientId !== undefined && row.patientId !== '') this.presence.patientId = true;
    if (row.wait1Days !== undefined && row.wait1Days !== '') this.presence.wait1 = true;
    if (row.scheduledAppointment !== undefined && row.scheduledAppointment !== '') this.presence.wait1 = true;
    if (row.wait2Days !== undefined && row.wait2Days !== '') this.presence.wait2 = true;
    if (row.scheduledAppointment2 !== undefined && row.scheduledAppointment2 !== '') this.presence.wait2 = true;
    if (row.daysUntilReferralResponse !== undefined && row.daysUntilReferralResponse !== '') this.presence.cycle = true;
    if (row.acceptedDate !== undefined && row.acceptedDate !== '') this.presence.cycle = true;
    if (row.patientPreference !== undefined && row.patientPreference !== '') this.presence.preference = true;
    if (row.receivedReferralComplete !== undefined && row.receivedReferralComplete !== '') this.presence.complete = true;
    if (row.referrerName !== undefined && row.referrerName !== '') this.presence.referrer = true;
    if (row.referralSource !== undefined && row.referralSource !== '') this.presence.source = true;
    if (row.recipientName !== undefined && row.recipientName !== '') this.presence.recipient = true;

    this.intakeProcessed++;
    if (!this.intakeMinDate || creationIso < this.intakeMinDate) this.intakeMinDate = creationIso;
    if (!this.intakeMaxDate || creationIso > this.intakeMaxDate) this.intakeMaxDate = creationIso;

    if (row.patientId) this.intakeUniquePatients.add(row.patientId);

    const month = creationIso.slice(0, 7);
    const fiscalYear = computeFiscalYear(creationIso);
    const quarter = computeQuarter(creationIso);
    const isoWeek = computeISOWeek(creationIso);

    let bucket = this.intakeMonths[month];
    if (!bucket) {
      bucket = {
        month,
        fiscalYear,
        quarter,
        isoWeeks: new Set(),
        total: 0,
        patientIds: new Set(),
        wait1Days: [],
        wait2Days: [],
        cycleDays: [],
        completeCount: 0,
        incompleteCount: 0,
        patientPref: {},
        byRecipient: {},
        byReferrer: {},
        bySentType: {},
      };
      this.intakeMonths[month] = bucket;
    }
    bucket.total++;
    if (row.patientId) bucket.patientIds.add(row.patientId);
    if (isoWeek) {
      bucket.isoWeeks.add(isoWeek);
      const wk = this.intakeWeeks[isoWeek];
      if (!wk) this.intakeWeeks[isoWeek] = { count: 1, month };
      else wk.count++;
    }

    let w1 = parseNumeric(row.wait1Days);
    if (w1 === null) w1 = diffDays(row.scheduledAppointment, row.referralCreationDate);
    if (w1 !== null && w1 >= 0) {
      bucket.wait1Days.push(w1);
      this.intakeWait1Count++;
    }

    let w2 = parseNumeric(row.wait2Days);
    if (w2 === null) w2 = diffDays(row.scheduledAppointment2, row.referralCreationDate);
    if (w2 !== null && w2 >= 0) {
      bucket.wait2Days.push(w2);
      this.intakeWait2Count++;
    }

    let cycle = parseNumeric(row.daysUntilReferralResponse);
    if (cycle === null) cycle = diffDays(row.acceptedDate, row.referralCreationDate);
    if (cycle !== null && cycle >= 0) {
      bucket.cycleDays.push(cycle);
      this.intakeCycleSum += cycle;
      this.intakeCycleCount++;
    }

    const completeBool = parseBool(row.receivedReferralComplete);
    if (completeBool === true) {
      bucket.completeCount++;
      this.intakeCompleteCount++;
    } else if (completeBool === false) {
      bucket.incompleteCount++;
      this.intakeIncompleteCount++;
    }

    const pref = normalizePatientPref(row.patientPreference);
    if (pref) bucket.patientPref[pref] = (bucket.patientPref[pref] || 0) + 1;

    const recipient = row.recipientName ? String(row.recipientName).trim() : '';
    const recipientKey = recipient || '(Unknown)';
    let rec = bucket.byRecipient[recipientKey];
    if (!rec) {
      rec = { count: 0, wait1Days: [], wait2Days: [] };
      bucket.byRecipient[recipientKey] = rec;
    }
    rec.count++;
    if (w1 !== null && w1 >= 0) rec.wait1Days.push(w1);
    if (w2 !== null && w2 >= 0) rec.wait2Days.push(w2);

    const referrer = row.referrerName ? String(row.referrerName).trim().toUpperCase() : '(UNKNOWN)';
    bucket.byReferrer[referrer] = (bucket.byReferrer[referrer] || 0) + 1;

    const sentType = (row.referralSource && String(row.referralSource).trim()) || '(Unknown)';
    let st = bucket.bySentType[sentType];
    if (!st) {
      st = { count: 0, referrers: new Set() };
      bucket.bySentType[sentType] = st;
    }
    st.count++;
    if (row.referrerName) st.referrers.add(String(row.referrerName).trim());
  }

  private finalizeIntake(): IntakeAnalytics {
    const byMonth: Record<string, IntakeMonthBucket> = {};
    const monthsByQuarter: Record<string, string[]> = {};
    const quartersByFy: Record<string, string[]> = {};
    const weeksByMonth: Record<string, string[]> = {};
    const fySet = new Set<string>();

    const recipientFinalize = (r: IntakeRecipientWork): IntakeRecipientBucket => ({
      count: r.count,
      wait1Days: r.wait1Days,
      wait2Days: r.wait2Days,
    });
    const sentTypeFinalize = (s: IntakeSentTypeWork): IntakeSentTypeBucket => ({
      count: s.count,
      referrers: [...s.referrers],
    });

    const monthKeys = Object.keys(this.intakeMonths).sort();
    for (const m of monthKeys) {
      const w = this.intakeMonths[m];
      const isoWeeks = [...w.isoWeeks].sort();
      weeksByMonth[m] = isoWeeks;
      const byRecipient: Record<string, IntakeRecipientBucket> = {};
      for (const [k, v] of Object.entries(w.byRecipient)) byRecipient[k] = recipientFinalize(v);
      const bySentType: Record<string, IntakeSentTypeBucket> = {};
      for (const [k, v] of Object.entries(w.bySentType)) bySentType[k] = sentTypeFinalize(v);

      byMonth[m] = {
        month: w.month,
        fiscalYear: w.fiscalYear,
        quarter: w.quarter,
        isoWeeks,
        total: w.total,
        patientIds: [...w.patientIds],
        wait1Days: w.wait1Days,
        wait2Days: w.wait2Days,
        cycleDays: w.cycleDays,
        completeCount: w.completeCount,
        incompleteCount: w.incompleteCount,
        patientPref: w.patientPref,
        byRecipient,
        byReferrer: w.byReferrer,
        bySentType,
      };
      fySet.add(w.fiscalYear);
      if (!monthsByQuarter[w.quarter]) monthsByQuarter[w.quarter] = [];
      monthsByQuarter[w.quarter].push(m);
      if (!quartersByFy[w.fiscalYear]) quartersByFy[w.fiscalYear] = [];
      if (!quartersByFy[w.fiscalYear].includes(w.quarter)) quartersByFy[w.fiscalYear].push(w.quarter);
    }

    for (const fy of Object.keys(quartersByFy)) quartersByFy[fy].sort();
    for (const q of Object.keys(monthsByQuarter)) monthsByQuarter[q].sort();

    return {
      earliestDate: this.intakeMinDate,
      latestDate: this.intakeMaxDate,
      fiscalYears: [...fySet].sort(),
      quartersByFy,
      monthsByQuarter,
      weeksByMonth,
      byMonth,
      byWeek: { ...this.intakeWeeks },
      totalProcessed: this.intakeProcessed,
      uniquePatientCount: this.intakeUniquePatients.size,
      completeCount: this.intakeCompleteCount,
      incompleteCount: this.intakeIncompleteCount,
      cycleSum: this.intakeCycleSum,
      cycleCount: this.intakeCycleCount,
      wait1Count: this.intakeWait1Count,
      wait2Count: this.intakeWait2Count,
      presence: { ...this.presence },
    };
  }

  finalize(): AccumulatorOutput {
    const mOff = (m: string, off: number) => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + off); return d.toISOString().slice(0, 7); };
    const monthKeys = Object.keys(this.monthly).sort();
    const curM = monthKeys.length ? monthKeys[monthKeys.length - 1] : new Date().toISOString().slice(0, 7);
    const lastFullM = mOff(curM, -1); const cmp1M = mOff(lastFullM, -1); const cmp3M = mOff(lastFullM, -3); const cmp12M = mOff(lastFullM, -12);
    let cum = 0;
    const timeline = Object.keys(this.monthly).sort().map(m => { cum += this.monthly[m]; return { label: m, value: this.monthly[m], cumulative: cum }; });
    const curMCount = this.monthly[curM] || 0; const lastFullCount = this.monthly[lastFullM] || 0;
    const cmp1Count = this.monthly[cmp1M] || 0; const cmp3Count = this.monthly[cmp3M] || 0; const cmp12Count = this.monthly[cmp12M] || 0;
    const pctChg = (cur: number, prev: number): { val: string; num: number } => prev === 0 ? { val: 'N/A', num: 0 } : { val: (Math.round(((cur - prev) / prev) * 1000) / 10 >= 0 ? '+' : '') + Math.round(((cur - prev) / prev) * 1000) / 10 + '%', num: Math.round(((cur - prev) / prev) * 1000) / 10 };
    const chg1 = pctChg(lastFullCount, cmp1Count); const chg3 = pctChg(lastFullCount, cmp3Count); const chg12 = pctChg(lastFullCount, cmp12Count);

    const weekly = Object.keys(this.weekly).sort().map(w => ({ label: w, total: this.weekly[w].total, test: this.weekly[w].test, nonTest: this.weekly[w].nonTest, senders: this.weekly[w].senders.size, receivers: this.weekly[w].receivers.size }));
    const byTarget = Object.entries(this.byTarget).map(([sn, d]) => ({ siteNum: sn, siteName: d.siteName, totalRefs: d.totalRefs, uniqueSenders: d.senders.size, states: d.states, listings: Object.entries(d.listings).map(([ref, ld]) => ({ ref, title: ld.title, count: ld.count })).sort((a, b) => b.count - a.count) })).sort((a, b) => b.totalRefs - a.totalRefs);
    const bySource = Object.entries(this.bySource).map(([sn, d]) => ({ siteNum: sn, siteName: d.siteName, totalRefs: d.totalRefs, uniqueTargets: d.targets.size, uniqueUsers: d.users.size })).sort((a, b) => b.totalRefs - a.totalRefs);
    const mapSrc = (ss: Record<string, { name: string; count: number }>) => Object.entries(ss).map(([sn, d]) => ({ siteNum: sn, siteName: d.name, count: d.count })).sort((a, b) => b.count - a.count);
    const bySenderRows = Object.entries(this.bySender).map(([un, d]) => ({ userName: un, fullName: d.fullName, clinicianType: d.clinicianType, profId: d.profId, totalRefs: d.totalRefs, uniqueTargets: d.targets.size, uniqueListings: d.targetListings.size, isUnknown: false, srcSites: mapSrc(d.srcSites) })).sort((a, b) => b.totalRefs - a.totalRefs);
    const bySender = this.unknownSenderCount > 0 ? [{ userName: '', fullName: '(Unknown sender)', clinicianType: '', profId: '', totalRefs: this.unknownSenderCount, uniqueTargets: this.unknownTargets.size, uniqueListings: this.unknownListings.size, isUnknown: true, srcSites: mapSrc(this.unknownSrcSites) }, ...bySenderRows] : bySenderRows;

    const byRegionSorted = Object.entries(this.regionMap).sort((a, b) => b[1] - a[1]);
    const byRaNameSorted = Object.entries(this.raNameMap).sort((a, b) => b[1] - a[1]);
    const bySvcSorted = Object.entries(this.serviceMap).sort((a, b) => b[1] - a[1]);
    const byCtSorted = Object.entries(this.clinTypeMap).sort((a, b) => b[1] - a[1]);
    const topN = (entries: [string, number][]) => {
      const top = entries.slice(0, 10); const other = entries.slice(10).reduce((s, e) => s + e[1], 0);
      return [...top.map(([l, v]) => ({ label: l, value: v })), ...(other > 0 ? [{ label: 'All others', value: other }] : [])];
    };

    const byEmrSent = Object.entries(this.emrSent).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l || 'None', value: v }));
    const byEmrRecv = Object.entries(this.emrRecv).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l || 'None', value: v }));
    const fhirCount = Object.entries(this.sourceTypeMap).filter(([k]) => k.toUpperCase().includes('FHIR')).reduce((s, e) => s + e[1], 0);

    const distinctInitialTargetRefs = [...this.initialTargetRefs.entries()]
      .map(([ref, title]) => ({ ref, title }))
      .sort((a, b) => a.ref.localeCompare(b.ref));

    const referral: ReferralAnalytics = {
      total: this.totalRows, distinctRefs: this.distinctRefs.size,
      uniqueSendingSites: this.uniqueSendingSites.size, uniqueTargetSites: this.uniqueTargetSites.size, uniqueSenders: this.uniqueSenders.size, uniqueProfIds: this.uniqueProfIds.size, uniqueTargetRefs: this.uniqueTargetRefs.size, distinctInitialTargetRefs,
      curMCount, curM, lastFullM, lastFullCount, chg1, cmp1M, cmp1Count, chg3, cmp3M, cmp3Count, chg12, cmp12M, cmp12Count, earliestDate: this.earliestDate,
      fhirCount, fhirPct: percentage(fhirCount, this.totalRows),
      timeline, weekly, byTarget, bySource, bySender,
      byRegion: topN(byRegionSorted), byRaName: topN(byRaNameSorted), byService: topN(bySvcSorted), byClinType: topN(byCtSorted), byEmrSent, byEmrRecv,
    };
    return { referral, intake: this.finalizeIntake() };
  }
}
