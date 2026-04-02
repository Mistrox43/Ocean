import { useMemo } from 'react';
import type { SiteStats } from '@/types';

export function useSiteStats(sites: Record<string, string>[] | null): SiteStats | null {
  return useMemo(() => {
    if (!sites) return null;
    const t = sites.length;
    const v = sites.filter(s => s.validatedSite === 'TRUE').length;
    const pm = sites.filter(s => s.patientMessagingEnabled === 'TRUE').length;
    const ob = sites.filter(s => s.onlineBookingEnabled === 'TRUE').length;
    const tf = sites.reduce((s, r) => s + (parseFloat(r.estimatedFees) || 0), 0);
    const tpl = sites.reduce((s, r) => s + (parseInt(r.patientMessagingLicences) || 0), 0);
    const tol = sites.reduce((s, r) => s + (parseInt(r.onlineBookingLicences) || 0), 0);
    const em: Record<string, number> = {};
    sites.forEach(s => { const e = s.emr || 'None'; em[e] = (em[e] || 0) + 1; });
    return {
      total: t, validated: v, pmEnabled: pm, obEnabled: ob,
      totalFees: tf, totalPmLic: tpl, totalObLic: tol, emrMap: em,
      withListings: sites.filter(s => parseInt(s.approvedListings) > 0).length,
    };
  }, [sites]);
}
