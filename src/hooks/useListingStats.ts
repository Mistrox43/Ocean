import { useMemo } from 'react';
import { percentage } from '@/utils';
import type { ListingStats } from '@/types';

export function useListingStats(
  filteredListings: Record<string, string>[] | null,
  geoGroupField: string,
): ListingStats | null {
  return useMemo(() => {
    if (!filteredListings) return null;

    // Single-pass reduce replaces 13 separate .filter() calls
    const counts = filteredListings.reduce(
      (acc, l) => {
        if (l.eReferrals === 'ENABLED') acc.eRefEnabled++;
        if (l.eConsults === 'ENABLED') acc.eConEnabled++;
        if ((l.raApprovalStatus || '').toUpperCase() === 'APPROVED') acc.approved++;
        if ((l.raApprovalStatus || '').toUpperCase() === 'PENDING') acc.pending++;
        if (l.CCEnabled === 'CC_ENABLED') acc.ccEnabled++;
        if (l.CCSEK === 'SEK_STORED') acc.sekStored++;
        if (l.listingRepositoryContribution === 'CONTRIBUTING') acc.contributing++;
        if (l.testMode === 'TRUE') acc.testMode++;
        if (l.trusteeCustodian === 'TRUSTEE_CUSTODIAN') acc.trustee++;
        if (l.trusteeCustodian === 'NON_TRUSTEE_CUSTODIAN') acc.nonTrustee++;
        if (l.trusteeCustodian === 'UNSPECIFIED') acc.unspecTrustee++;
        if (l.trusteeCustodian === 'NOT_ACCEPTING_EREFERRALS') acc.notAccepting++;
        return acc;
      },
      { eRefEnabled: 0, eConEnabled: 0, approved: 0, pending: 0, ccEnabled: 0, sekStored: 0, contributing: 0, testMode: 0, trustee: 0, nonTrustee: 0, unspecTrustee: 0, notAccepting: 0 },
    );

    const typeMap: Record<string, number> = {};
    filteredListings.forEach(l => { const x = l.listingType || 'Unknown'; typeMap[x] = (typeMap[x] || 0) + 1; });

    const geoMap: Record<string, { total: number; enabled: number }> = {};
    filteredListings.forEach(l => {
      const key = l[geoGroupField] || 'Unspecified';
      if (!geoMap[key]) geoMap[key] = { total: 0, enabled: 0 };
      geoMap[key].total++;
      if (l.eReferrals === 'ENABLED') geoMap[key].enabled++;
    });
    const geoData = Object.entries(geoMap).map(([region, d]) => ({
      region, ...d, rate: Math.round(percentage(d.enabled, d.total)),
    }));

    return { total: filteredListings.length, ...counts, typeMap, geoData };
  }, [filteredListings, geoGroupField]);
}
