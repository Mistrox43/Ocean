import { useMemo } from 'react';
import { normalizeSiteNumber } from '@/utils';
import type { StaffingRow, UserStats } from '@/types';

export function useStaffing(
  filteredListings: Record<string, string>[] | null,
  sites: Record<string, string>[] | null,
  userStats: UserStats | null,
): StaffingRow[] | null {
  return useMemo(() => {
    if (!filteredListings || !sites) return null;
    const siteLm: Record<string, { raClinTotal: number; listingDetails: StaffingRow['details'] }> = {};
    filteredListings.forEach(l => {
      const sn = normalizeSiteNumber(l.siteNum);
      if (!siteLm[sn]) siteLm[sn] = { raClinTotal: 0, listingDetails: [] };
      const rc = parseInt(l.raCliniciansCount) || 0;
      siteLm[sn].raClinTotal += rc;
      siteLm[sn].listingDetails.push({
        ref: l.ref || '', title: l.title || 'Untitled', raClinCount: rc,
        eReferrals: l.eReferrals || '', eConsults: l.eConsults || '',
        listingType: l.listingType || '', claimedByUser: l.claimedByUser || '',
        clinicianProfId: l.clinicianProfessionalId || '',
      });
    });
    return sites.map(s => {
      const k = normalizeSiteNumber(s.siteNumber);
      const uc = userStats?.siteUserCount[k] || 0;
      const sl = siteLm[k] || { raClinTotal: 0, listingDetails: [] };
      const delta = uc - sl.raClinTotal;
      return {
        siteNum: s.siteNumber, siteName: s.siteName, emr: s.emr,
        userCount: uc, raClinTotal: sl.raClinTotal, delta,
        absDelta: Math.abs(delta), listingCount: sl.listingDetails.length,
        details: sl.listingDetails,
      };
    });
  }, [filteredListings, sites, userStats]);
}
