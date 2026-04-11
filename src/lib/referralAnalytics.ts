import { normalizeSiteNumber, formatDate, percentage } from '@/utils';
import type { ReferralAnalytics } from '@/types';

export function computeReferralAnalytics(
  filteredReferralRows: Record<string, string>[] | null,
  referrals: Record<string, string>[] | null,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
): ReferralAnalytics | null {
  if (!filteredReferralRows) return null;

  const siteNameLookup: Record<string, string> = {};
  const siteEmrLookup: Record<string, string> = {};
  if (sites) sites.forEach(s => { const k = normalizeSiteNumber(s.siteNumber); siteNameLookup[k] = s.siteName; siteEmrLookup[k] = s.emr || ''; });
  const listingTitleLookup: Record<string, string> = {};
  if (listings) listings.forEach(l => { if (l.ref) listingTitleLookup[l.ref] = l.title || 'Untitled'; });
  const userNameLookup: Record<string, { name: string; clinicianType: string }> = {};
  if (users) users.forEach(u => { if (u.userName) userNameLookup[u.userName] = { name: u.name || '', clinicianType: u.clinicianType || '' }; });

  const now = new Date(); const curM = now.toISOString().slice(0, 7);
  const mOff = (m: string, off: number) => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + off); return d.toISOString().slice(0, 7); };
  const lastFullM = mOff(curM, -1); const cmp1M = mOff(curM, -2); const cmp3M = mOff(curM, -4); const cmp12M = mOff(curM, -13);

  const mm: Record<string, number> = {};
  filteredReferralRows.forEach(r => { const fd = formatDate(r.referralCreationDate); if (fd && fd.length >= 7) { const m = fd.substring(0, 7); mm[m] = (mm[m] || 0) + 1; } });
  let cum = 0;
  const timeline = Object.keys(mm).sort().map(m => { cum += mm[m]; return { label: m, value: mm[m], cumulative: cum }; });
  const curMCount = mm[curM] || 0; const lastFullCount = mm[lastFullM] || 0;
  const cmp1Count = mm[cmp1M] || 0; const cmp3Count = mm[cmp3M] || 0; const cmp12Count = mm[cmp12M] || 0;
  const pctChg = (cur: number, prev: number): { val: string; num: number } => prev === 0 ? { val: 'N/A', num: 0 } : { val: (Math.round(((cur - prev) / prev) * 1000) / 10 >= 0 ? '+' : '') + Math.round(((cur - prev) / prev) * 1000) / 10 + '%', num: Math.round(((cur - prev) / prev) * 1000) / 10 };
  const chg1 = pctChg(lastFullCount, cmp1Count); const chg3 = pctChg(lastFullCount, cmp3Count); const chg12 = pctChg(lastFullCount, cmp12Count);
  const allDates = filteredReferralRows.map(r => formatDate(r.referralCreationDate)).filter(d => d && d.length >= 10).sort();
  const earliestDate = allDates.length > 0 ? allDates[0] : '';

  const wk: Record<string, { total: number; test: number; nonTest: number; senders: Set<string>; receivers: Set<string> }> = {};
  (referrals || []).forEach(r => {
    const fd = formatDate(r.referralCreationDate); if (!fd || !/^\d{4}-\d{2}-\d{2}$/.test(fd)) return;
    const d = new Date(fd.substring(0, 10) + 'T00:00:00Z'); if (isNaN(d.getTime())) return;
    const day = d.getUTCDay(); const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    d.setUTCDate(diff); const wkKey = d.toISOString().slice(0, 10);
    if (!wk[wkKey]) wk[wkKey] = { total: 0, test: 0, nonTest: 0, senders: new Set(), receivers: new Set() };
    wk[wkKey].total++;
    const isTest = r.sentToTestListing === 'TRUE';
    if (isTest) wk[wkKey].test++; else wk[wkKey].nonTest++;
    if (!isTest) { if (r.referrerProfessionalId) wk[wkKey].senders.add(r.referrerProfessionalId); if (r.referralTargetRef) wk[wkKey].receivers.add(r.referralTargetRef); }
  });
  const weekly = Object.keys(wk).sort().map(w => ({ label: w, total: wk[w].total, test: wk[w].test, nonTest: wk[w].nonTest, senders: wk[w].senders.size, receivers: wk[w].receivers.size }));

  const tgt: Record<string, { siteName: string; totalRefs: number; senders: Set<string>; states: Record<string, number>; listings: Record<string, { title: string; count: number }> }> = {};
  filteredReferralRows.forEach(r => {
    const sn = normalizeSiteNumber(r.siteNum);
    if (!tgt[sn]) tgt[sn] = { siteName: siteNameLookup[sn] || r.recipientName || sn, totalRefs: 0, senders: new Set(), states: {}, listings: {} };
    tgt[sn].totalRefs++;
    if (r.referredByUserName) tgt[sn].senders.add(r.referredByUserName);
    const st = r.referralState || 'UNKNOWN'; tgt[sn].states[st] = (tgt[sn].states[st] || 0) + 1;
    const lref = r.referralTargetRef || '';
    if (lref) { if (!tgt[sn].listings[lref]) tgt[sn].listings[lref] = { title: listingTitleLookup[lref] || r.recipientName || lref, count: 0 }; tgt[sn].listings[lref].count++; }
  });
  const byTarget = Object.entries(tgt).map(([sn, d]) => ({ siteNum: sn, siteName: d.siteName, totalRefs: d.totalRefs, uniqueSenders: d.senders.size, states: d.states, listings: Object.entries(d.listings).map(([ref, ld]) => ({ ref, title: ld.title, count: ld.count })).sort((a, b) => b.count - a.count) })).sort((a, b) => b.totalRefs - a.totalRefs);

  const src: Record<string, { siteName: string; totalRefs: number; targets: Set<string>; users: Set<string> }> = {};
  filteredReferralRows.forEach(r => {
    const sn = normalizeSiteNumber(r.srcsiteNum); if (!sn) return;
    if (!src[sn]) src[sn] = { siteName: siteNameLookup[sn] || r.srcSiteName || sn, totalRefs: 0, targets: new Set(), users: new Set() };
    src[sn].totalRefs++; src[sn].targets.add(normalizeSiteNumber(r.siteNum));
    if (r.referredByUserName) src[sn].users.add(r.referredByUserName);
  });
  const bySource = Object.entries(src).map(([sn, d]) => ({ siteNum: sn, siteName: d.siteName, totalRefs: d.totalRefs, uniqueTargets: d.targets.size, uniqueUsers: d.users.size })).sort((a, b) => b.totalRefs - a.totalRefs);

  const snd: Record<string, { fullName: string; clinicianType: string; profId: string; totalRefs: number; targets: Set<string>; targetListings: Set<string>; srcSites: Record<string, { name: string; count: number }> }> = {};
  let unknownSenderCount = 0; const unknownTargets = new Set<string>(); const unknownListings = new Set<string>(); const unknownSrcSites: Record<string, { name: string; count: number }> = {};
  filteredReferralRows.forEach(r => {
    const un = r.referredByUserName || '';
    const srcSn = normalizeSiteNumber(r.srcsiteNum); const srcName = siteNameLookup[srcSn] || r.srcSiteName || srcSn || 'Unknown';
    if (!un) { unknownSenderCount++; unknownTargets.add(normalizeSiteNumber(r.siteNum)); if (r.referralTargetRef) unknownListings.add(r.referralTargetRef); if (srcSn) { if (!unknownSrcSites[srcSn]) unknownSrcSites[srcSn] = { name: srcName, count: 0 }; unknownSrcSites[srcSn].count++; } return; }
    if (!snd[un]) snd[un] = { fullName: r.referredByUserFullName || userNameLookup[un]?.name || un, clinicianType: r.referrerClinicianType || userNameLookup[un]?.clinicianType || '', profId: r.referrerProfessionalId || '', totalRefs: 0, targets: new Set(), targetListings: new Set(), srcSites: {} };
    snd[un].totalRefs++; snd[un].targets.add(normalizeSiteNumber(r.siteNum));
    if (r.referralTargetRef) snd[un].targetListings.add(r.referralTargetRef);
    if (!snd[un].profId && r.referrerProfessionalId) snd[un].profId = r.referrerProfessionalId;
    if (srcSn) { if (!snd[un].srcSites[srcSn]) snd[un].srcSites[srcSn] = { name: srcName, count: 0 }; snd[un].srcSites[srcSn].count++; }
  });
  const mapSrc = (ss: Record<string, { name: string; count: number }>) => Object.entries(ss).map(([sn, d]) => ({ siteNum: sn, siteName: d.name, count: d.count })).sort((a, b) => b.count - a.count);
  const bySenderRows = Object.entries(snd).map(([un, d]) => ({ userName: un, fullName: d.fullName, clinicianType: d.clinicianType, profId: d.profId, totalRefs: d.totalRefs, uniqueTargets: d.targets.size, uniqueListings: d.targetListings.size, isUnknown: false, srcSites: mapSrc(d.srcSites) })).sort((a, b) => b.totalRefs - a.totalRefs);
  const bySender = unknownSenderCount > 0 ? [{ userName: '', fullName: '(Unknown sender)', clinicianType: '', profId: '', totalRefs: unknownSenderCount, uniqueTargets: unknownTargets.size, uniqueListings: unknownListings.size, isUnknown: true, srcSites: mapSrc(unknownSrcSites) }, ...bySenderRows] : bySenderRows;

  const regionLookup: Record<string, string> = {};
  if (listings) listings.forEach(l => { if (l.ref) regionLookup[l.ref] = l.healthRegion || ''; });
  const regionMap: Record<string, number> = {};
  filteredReferralRows.forEach(r => {
    const tRef = r.referralTargetRef || '';
    let region: string;
    if (!tRef || !(tRef in regionLookup)) { region = 'Referrals not mapped to listings'; }
    else if (!regionLookup[tRef]) { region = 'Region not defined'; }
    else { region = regionLookup[tRef]; }
    regionMap[region] = (regionMap[region] || 0) + 1;
  });
  const byRegionSorted = Object.entries(regionMap).sort((a, b) => b[1] - a[1]);
  const topRegions = byRegionSorted.slice(0, 10); const otherRegions = byRegionSorted.slice(10).reduce((s, e) => s + e[1], 0);
  const byRegion = [...topRegions.map(([l, v]) => ({ label: l, value: v })), ...(otherRegions > 0 ? [{ label: 'All others', value: otherRegions }] : [])];

  const svcMap: Record<string, number> = {}; filteredReferralRows.forEach(r => { const s = r.currentHealthService || r.initialHealthService || 'Unknown'; svcMap[s] = (svcMap[s] || 0) + 1; });
  const bySvcSorted = Object.entries(svcMap).sort((a, b) => b[1] - a[1]);
  const topSvc = bySvcSorted.slice(0, 10); const otherSvc = bySvcSorted.slice(10).reduce((s, e) => s + e[1], 0);
  const byService = [...topSvc.map(([l, v]) => ({ label: l, value: v })), ...(otherSvc > 0 ? [{ label: 'All others', value: otherSvc }] : [])];

  const ctMap: Record<string, number> = {}; filteredReferralRows.forEach(r => { const c = r.referrerClinicianType || 'Unknown'; ctMap[c] = (ctMap[c] || 0) + 1; });
  const byCtSorted = Object.entries(ctMap).sort((a, b) => b[1] - a[1]);
  const topCt = byCtSorted.slice(0, 10); const otherCt = byCtSorted.slice(10).reduce((s, e) => s + e[1], 0);
  const byClinType = [...topCt.map(([l, v]) => ({ label: l, value: v })), ...(otherCt > 0 ? [{ label: 'All others', value: otherCt }] : [])];

  const emrSent: Record<string, number> = {}; const emrRecv: Record<string, number> = {};
  filteredReferralRows.forEach(r => {
    const srcK = normalizeSiteNumber(r.srcsiteNum); const tgtK = normalizeSiteNumber(r.siteNum);
    const srcEmr = siteEmrLookup[srcK] || 'Unknown EMR'; const tgtEmr = siteEmrLookup[tgtK] || 'Unknown EMR';
    emrSent[srcEmr] = (emrSent[srcEmr] || 0) + 1; emrRecv[tgtEmr] = (emrRecv[tgtEmr] || 0) + 1;
  });
  const byEmrSent = Object.entries(emrSent).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l || 'None', value: v }));
  const byEmrRecv = Object.entries(emrRecv).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l || 'None', value: v }));

  const srcTypeMap: Record<string, number> = {}; filteredReferralRows.forEach(r => { const s = r.referralSource || 'Unknown'; srcTypeMap[s] = (srcTypeMap[s] || 0) + 1; });
  const fhirCount = Object.entries(srcTypeMap).filter(([k]) => k.toUpperCase().includes('FHIR')).reduce((s, e) => s + e[1], 0);

  const uniqueProfIds = new Set(filteredReferralRows.map(r => r.referrerProfessionalId).filter(Boolean)).size;
  const uniqueTargetRefs = new Set(filteredReferralRows.map(r => r.referralTargetRef).filter(Boolean)).size;
  const distinctRefs = new Set(filteredReferralRows.map(r => r.referralRef).filter(Boolean)).size;

  return {
    total: filteredReferralRows.length, distinctRefs,
    uniqueSendingSites: new Set(filteredReferralRows.map(r => normalizeSiteNumber(r.srcsiteNum)).filter(Boolean)).size,
    uniqueTargetSites: new Set(filteredReferralRows.map(r => normalizeSiteNumber(r.siteNum)).filter(Boolean)).size,
    uniqueSenders: new Set(filteredReferralRows.map(r => r.referredByUserName).filter(Boolean)).size,
    uniqueProfIds, uniqueTargetRefs,
    curMCount, curM, lastFullM, lastFullCount,
    chg1, cmp1M, cmp1Count, chg3, cmp3M, cmp3Count, chg12, cmp12M, cmp12Count, earliestDate,
    fhirCount, fhirPct: percentage(fhirCount, filteredReferralRows.length),
    timeline, weekly, byTarget, bySource, bySender,
    byRegion, byService, byClinType, byEmrSent, byEmrRecv,
  };
}
