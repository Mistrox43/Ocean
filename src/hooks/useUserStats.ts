import { useMemo } from 'react';
import { formatDate, normalizeSiteNumber } from '@/utils';
import type { UserStats } from '@/types';

export function useUserStats(users: Record<string, string>[] | null): UserStats | null {
  return useMemo(() => {
    if (!users) return null;
    const t = users.length;
    const v = users.filter(u => u.valid === 'TRUE').length;
    const rm: Record<string, number> = {};
    users.forEach(u => { const r = u.clinicianType || 'Unknown'; rm[r] = (rm[r] || 0) + 1; });
    const mm: Record<string, number> = {};
    users.forEach(u => {
      const fd = formatDate(u.dateOfAgreement);
      if (fd && fd.length >= 7) { const m = fd.substring(0, 7); mm[m] = (mm[m] || 0) + 1; }
    });
    let cum = 0;
    const tl = Object.keys(mm).sort().map(m => { cum += mm[m]; return { label: m, value: mm[m], cumulative: cum }; });
    const vm: Record<string, number> = {};
    users.forEach(u => { const x = u.licenseVersion || 'Unknown'; vm[x] = (vm[x] || 0) + 1; });
    const suc: Record<string, number> = {};
    users.forEach(u => {
      if (u.siteNumbers) u.siteNumbers.split(';').map((s: string) => s.trim()).filter(Boolean).forEach((sn: string) => {
        const k = normalizeSiteNumber(sn); suc[k] = (suc[k] || 0) + 1;
      });
    });
    return { total: t, valid: v, roleMap: rm, timeline: tl, versionMap: vm, siteUserCount: suc };
  }, [users]);
}
