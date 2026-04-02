import { useMemo } from 'react';
import { normalizeSiteNumber, percentage } from '@/utils';
import type { SiteMaturityRow, UserStats } from '@/types';

export function useSiteMaturity(
  filteredListings: Record<string, string>[] | null,
  sites: Record<string, string>[] | null,
  userStats: UserStats | null,
): SiteMaturityRow[] | null {
  return useMemo(() => {
    if (!filteredListings || !sites) return null;
    const slm: Record<string, { total: number; eR: number; eC: number; cc: number }> = {};
    filteredListings.forEach(l => {
      const sn = normalizeSiteNumber(l.siteNum);
      if (!slm[sn]) slm[sn] = { total: 0, eR: 0, eC: 0, cc: 0 };
      slm[sn].total++;
      if (l.eReferrals === 'ENABLED') slm[sn].eR++;
      if (l.eConsults === 'ENABLED') slm[sn].eC++;
      if (l.CCEnabled === 'CC_ENABLED') slm[sn].cc++;
    });
    return sites.map(s => {
      const k = normalizeSiteNumber(s.siteNumber);
      const lm = slm[k] || { total: 0, eR: 0, eC: 0, cc: 0 };
      const uc = userStats?.siteUserCount[k] || 0;
      return {
        siteNum: s.siteNumber, siteName: s.siteName, total: lm.total,
        eRefEnabled: lm.eR, eConEnabled: lm.eC, ccEnabled: lm.cc,
        userCount: uc, validated: s.validatedSite === 'TRUE',
        emr: s.emr, adoptionRate: percentage(lm.eR, lm.total),
      };
    });
  }, [filteredListings, sites, userStats]);
}
