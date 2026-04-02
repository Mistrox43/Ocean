import { memo } from 'react';
import { COLORS } from '@/constants';
import { formatNumber } from '@/utils';

interface KPIProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: string;
}

export const KPI = memo(function KPI({ label, value, sub, color = COLORS.accent, icon }: KPIProps) {
  return <div style={{ background: COLORS.card, border: '1px solid ' + COLORS.border, borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden' }}>
    {icon && <div style={{ position: 'absolute', top: -20, right: -10, fontSize: 64, opacity: 0.06, color }}>{icon}</div>}
    <span style={{ fontSize: 11, color: COLORS.dimmed, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.1 }}>{typeof value === 'number' ? formatNumber(value) : value}</span>
    {sub && <span style={{ fontSize: 12, color: COLORS.muted }}>{sub}</span>}
  </div>;
});
