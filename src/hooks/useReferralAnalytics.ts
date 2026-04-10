import { useMemo } from 'react';
import { computeReferralAnalytics } from '@/lib/referralAnalytics';
import type { ReferralAnalytics } from '@/types';

export function useReferralAnalytics(
  filteredReferralRows: Record<string, string>[] | null,
  referrals: Record<string, string>[] | null,
  sites: Record<string, string>[] | null,
  listings: Record<string, string>[] | null,
  users: Record<string, string>[] | null,
  precomputed?: ReferralAnalytics | null,
): ReferralAnalytics | null {
  return useMemo(() => {
    if (precomputed) return precomputed;
    return computeReferralAnalytics(filteredReferralRows, referrals, sites, listings, users);
  }, [precomputed, filteredReferralRows, referrals, sites, listings, users]);
}
