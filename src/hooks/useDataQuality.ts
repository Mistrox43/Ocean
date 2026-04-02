import { useMemo } from 'react';
import { normalizeSiteNumber, formatDate } from '@/utils';
import type { DataQualityResult } from '@/types';

export function useDataQuality(
  filteredListings: Record<string, string>[] | null,
  sites: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
): DataQualityResult | null {
  return useMemo(() => {
    if (!filteredListings || !sites || !users) return null;
    const siteSet = new Set(sites.map(s => normalizeSiteNumber(s.siteNumber)));
    const listingSNSet = new Set(filteredListings.map(l => normalizeSiteNumber(l.siteNum)));

    // All unique normalized site numbers from users (exploded from semicolons)
    const userSNMap: Record<string, { users: string[]; count: number }> = {};
    const blankSiteUsers: typeof users = [];
    users.forEach(u => {
      const raw = (u.siteNumbers || '').trim();
      if (!raw) { blankSiteUsers.push(u); return; }
      raw.split(';').map((s: string) => s.trim()).filter(Boolean).forEach((sn: string) => {
        const k = normalizeSiteNumber(sn);
        if (!userSNMap[k]) userSNMap[k] = { users: [], count: 0 };
        userSNMap[k].users.push(u.userName || u.name || 'Unknown');
        userSNMap[k].count++;
      });
    });

    // All unique normalized site numbers from listings
    const listingSNMap: Record<string, number> = {};
    filteredListings.forEach(l => { const k = normalizeSiteNumber(l.siteNum); listingSNMap[k] = (listingSNMap[k] || 0) + 1; });

    // 1. Coverage matrix
    const userSNs = Object.keys(userSNMap);
    const userSNMatched = userSNs.filter(k => siteSet.has(k));
    const userSNOrphaned = userSNs.filter(k => !siteSet.has(k));
    const userLinksTotal = Object.values(userSNMap).reduce((s, v) => s + v.count, 0);
    const userLinksMatched = userSNMatched.reduce((s, k) => s + userSNMap[k].count, 0);
    const userLinksOrphaned = userSNOrphaned.reduce((s, k) => s + userSNMap[k].count, 0);

    const listSNs = Object.keys(listingSNMap);
    const listSNMatched = listSNs.filter(k => siteSet.has(k));
    const listSNOrphaned = listSNs.filter(k => !siteSet.has(k));
    const listLinksMatched = listSNMatched.reduce((s, k) => s + listingSNMap[k], 0);
    const listLinksOrphaned = listSNOrphaned.reduce((s, k) => s + listingSNMap[k], 0);

    const userSNInListings = userSNs.filter(k => listingSNSet.has(k));
    const userSNNotInListings = userSNs.filter(k => !listingSNSet.has(k));

    // 2. Orphaned users detail
    const orphanedUsers = users.filter(u => {
      const raw = (u.siteNumbers || '').trim();
      if (!raw) return false;
      const sns = raw.split(';').map((s: string) => s.trim()).filter(Boolean).map(normalizeSiteNumber);
      return sns.length > 0 && sns.every(k => !siteSet.has(k));
    }).map(u => ({ name: u.userName || u.name || 'Unknown', clinicianType: u.clinicianType || '', siteNumbers: u.siteNumbers || '', dateOfAgreement: formatDate(u.dateOfAgreement) || '' }));

    const partialOrphanUsers = users.filter(u => {
      const raw = (u.siteNumbers || '').trim();
      if (!raw) return false;
      const sns = raw.split(';').map((s: string) => s.trim()).filter(Boolean).map(normalizeSiteNumber);
      return sns.some(k => !siteSet.has(k)) && sns.some(k => siteSet.has(k));
    }).length;

    // 3. Orphaned site numbers inventory
    const allOrphanedSNs = [...new Set([...userSNOrphaned, ...listSNOrphaned])].map(k => ({
      siteNumber: k,
      userCount: userSNMap[k]?.count || 0,
      listingCount: listingSNMap[k] || 0,
      sampleUsers: (userSNMap[k]?.users || []).slice(0, 5),
    })).sort((a, b) => (b.userCount + b.listingCount) - (a.userCount + a.listingCount));

    // 4. Blank site number users
    const blankUsers = blankSiteUsers.map(u => ({ name: u.userName || u.name || 'Unknown', clinicianType: u.clinicianType || '', dateOfAgreement: formatDate(u.dateOfAgreement) || '', email: u.email || '' }));

    return {
      coverage: {
        userToSite: { uniqueSNs: userSNs.length, matched: userSNMatched.length, orphaned: userSNOrphaned.length, linksTotal: userLinksTotal, linksMatched: userLinksMatched, linksOrphaned: userLinksOrphaned },
        listingToSite: { uniqueSNs: listSNs.length, matched: listSNMatched.length, orphaned: listSNOrphaned.length, linksMatched: listLinksMatched, linksOrphaned: listLinksOrphaned },
        userToListing: { inListings: userSNInListings.length, notInListings: userSNNotInListings.length },
      },
      orphanedUsers, partialOrphanUsers,
      orphanedSNs: allOrphanedSNs,
      blankUsers,
    };
  }, [filteredListings, sites, users]);
}
