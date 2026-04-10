import { formatDate, normalizeSiteNumber, percentage } from '@/utils';
import type { ReferralAnalytics } from '@/types';

type Row = Record<string, string>;
type Ctx = { sites: Row[] | null; listings: Row[] | null; users: Row[] | null };

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

  private regionMap: Record<string, number> = {};
  private serviceMap: Record<string, number> = {};
  private clinTypeMap: Record<string, number> = {};
  private emrSent: Record<string, number> = {};
  private emrRecv: Record<string, number> = {};
  private sourceTypeMap: Record<string, number> = {};

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

    const fd = formatDate(row.referralCreationDate);
    if (fd && fd.length >= 7) {
      const m = fd.substring(0, 7);
      this.monthly[m] = (this.monthly[m] || 0) + 1;
    }
    if (fd && fd.length >= 10 && (!this.earliestDate || fd < this.earliestDate)) this.earliestDate = fd;

    if (fd && fd.length >= 10) {
      const d = new Date(fd.substring(0, 10) + 'T00:00:00Z'); const day = d.getUTCDay(); const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      d.setUTCDate(diff); const wkKey = d.toISOString().slice(0, 10);
      if (!this.weekly[wkKey]) this.weekly[wkKey] = { total: 0, test: 0, nonTest: 0, senders: new Set(), receivers: new Set() };
      this.weekly[wkKey].total++;
      const isTest = row.sentToTestListing === 'TRUE';
      if (isTest) this.weekly[wkKey].test++; else this.weekly[wkKey].nonTest++;
      if (!isTest) { if (row.referrerProfessionalId) this.weekly[wkKey].senders.add(row.referrerProfessionalId); if (row.referralTargetRef) this.weekly[wkKey].receivers.add(row.referralTargetRef); }
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
    const svc = row.currentHealthService || row.initialHealthService || 'Unknown'; this.serviceMap[svc] = (this.serviceMap[svc] || 0) + 1;
    const ct = row.referrerClinicianType || 'Unknown'; this.clinTypeMap[ct] = (this.clinTypeMap[ct] || 0) + 1;
    const srcEmr = this.siteEmrLookup[srcSite] || 'Unknown EMR'; const tgtEmr = this.siteEmrLookup[tgtSite] || 'Unknown EMR';
    this.emrSent[srcEmr] = (this.emrSent[srcEmr] || 0) + 1; this.emrRecv[tgtEmr] = (this.emrRecv[tgtEmr] || 0) + 1;
    const srcType = row.referralSource || 'Unknown'; this.sourceTypeMap[srcType] = (this.sourceTypeMap[srcType] || 0) + 1;
  }

  finalize(): ReferralAnalytics {
    const now = new Date(); const curM = now.toISOString().slice(0, 7);
    const mOff = (m: string, off: number) => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + off); return d.toISOString().slice(0, 7); };
    const lastFullM = mOff(curM, -1); const cmp1M = mOff(curM, -2); const cmp3M = mOff(curM, -4); const cmp12M = mOff(curM, -13);
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
    const bySvcSorted = Object.entries(this.serviceMap).sort((a, b) => b[1] - a[1]);
    const byCtSorted = Object.entries(this.clinTypeMap).sort((a, b) => b[1] - a[1]);
    const topN = (entries: [string, number][]) => {
      const top = entries.slice(0, 10); const other = entries.slice(10).reduce((s, e) => s + e[1], 0);
      return [...top.map(([l, v]) => ({ label: l, value: v })), ...(other > 0 ? [{ label: 'All others', value: other }] : [])];
    };

    const byEmrSent = Object.entries(this.emrSent).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l || 'None', value: v }));
    const byEmrRecv = Object.entries(this.emrRecv).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l || 'None', value: v }));
    const fhirCount = Object.entries(this.sourceTypeMap).filter(([k]) => k.toUpperCase().includes('FHIR')).reduce((s, e) => s + e[1], 0);

    return {
      total: this.totalRows, distinctRefs: this.distinctRefs.size,
      uniqueSendingSites: this.uniqueSendingSites.size, uniqueTargetSites: this.uniqueTargetSites.size, uniqueSenders: this.uniqueSenders.size, uniqueProfIds: this.uniqueProfIds.size, uniqueTargetRefs: this.uniqueTargetRefs.size,
      curMCount, curM, lastFullM, lastFullCount, chg1, cmp1M, cmp1Count, chg3, cmp3M, cmp3Count, chg12, cmp12M, cmp12Count, earliestDate: this.earliestDate,
      fhirCount, fhirPct: percentage(fhirCount, this.totalRows),
      timeline, weekly, byTarget, bySource, bySender,
      byRegion: topN(byRegionSorted), byService: topN(bySvcSorted), byClinType: topN(byCtSorted), byEmrSent, byEmrRecv,
    };
  }
}

