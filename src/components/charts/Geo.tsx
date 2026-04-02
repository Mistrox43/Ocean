import { memo } from 'react';
import { COLORS } from '@/constants';

interface GeoDataPoint {
  region: string;
  total: number;
  enabled: number;
  rate: number;
}

interface GeoProps {
  data: GeoDataPoint[];
}

export const Geo = memo(function Geo({ data }: GeoProps) {
  const sorted = [...data].sort((a, b) => b.total - a.total);
  const mt = Math.max(...sorted.map(d => d.total), 1);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', marginBottom: 4 }}>
      <div style={{ width: 160, fontSize: 10, color: COLORS.dimmed, fontWeight: 700, textTransform: 'uppercase' }}>Region</div>
      <div style={{ flex: 1, fontSize: 10, color: COLORS.dimmed }}>Distribution</div>
      <div style={{ width: 50, fontSize: 10, color: COLORS.dimmed, textAlign: 'right', fontWeight: 700 }}>Total</div>
      <div style={{ width: 50, fontSize: 10, color: COLORS.dimmed, textAlign: 'right', fontWeight: 700 }}>eRef</div>
      <div style={{ width: 50, fontSize: 10, color: COLORS.dimmed, textAlign: 'right', fontWeight: 700 }}>Rate</div>
    </div>
    {sorted.map((d, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <div style={{ width: 160, fontSize: 12, color: COLORS.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{d.region || 'Unspecified'}</div>
      <div style={{ flex: 1, height: 20, background: COLORS.border, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ height: '100%', width: (d.total / mt) * 100 + '%', background: COLORS.accent + '44', borderRadius: 3 }} />
        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: (d.enabled / mt) * 100 + '%', background: COLORS.green, borderRadius: 3, opacity: 0.8 }} />
      </div>
      <div style={{ width: 50, fontSize: 12, color: COLORS.text, textAlign: 'right', fontWeight: 600 }}>{d.total}</div>
      <div style={{ width: 50, fontSize: 12, color: COLORS.green, textAlign: 'right', fontWeight: 600 }}>{d.enabled}</div>
      <div style={{ width: 50, fontSize: 12, textAlign: 'right', fontWeight: 700, color: d.rate >= 70 ? COLORS.green : d.rate >= 40 ? COLORS.amber : COLORS.red }}>{d.rate}%</div>
    </div>)}
  </div>;
});
