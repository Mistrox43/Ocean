import React, { useState } from 'react';
import { COLORS } from '@/constants';
import { formatNumber, percentage } from '@/utils';

interface DonutProps {
  segments: { label: string; value: number; color: string }[];
  size?: number;
}

export const Donut = React.memo(function Donut({ segments, size = 160 }: DonutProps) {
  const [hov, setHov] = useState<number | null>(null);
  const total = segments.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const r = size / 2 - 8, cx = size / 2, cy = size / 2;
  let ca = -90;
  const arcs = segments.filter(s => s.value > 0).map(s => {
    const ang = (s.value / total) * 360;
    const sr = (ca * Math.PI) / 180, er = ((ca + ang) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(sr), y1 = cy + r * Math.sin(sr);
    const x2 = cx + r * Math.cos(er), y2 = cy + r * Math.sin(er);
    ca += ang;
    return { ...s, d: 'M ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + (+(ang > 180)) + ' 1 ' + x2 + ' ' + y2, pct: percentage(s.value, total) };
  });
  const ha = hov !== null && hov >= 0 && hov < arcs.length ? arcs[hov] : null;
  return <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <svg width={size} height={size} onMouseLeave={() => setHov(null)}>
      {arcs.map((a, i) => <path key={i} d={a.d} fill='none' stroke={a.color} strokeWidth={hov === i ? 30 : 24} style={{ opacity: hov !== null && hov !== i ? 0.3 : 1, transition: 'stroke-width 0.15s,opacity 0.15s', cursor: 'pointer' }} onMouseEnter={() => setHov(i)} />)}
      <text x={cx} y={cy - 6} textAnchor='middle' fill={ha ? ha.color : COLORS.text} fontSize={ha ? 20 : 22} fontWeight={700}>{ha ? formatNumber(ha.value) : formatNumber(total)}</text>
      <text x={cx} y={cy + 14} textAnchor='middle' fill={COLORS.dimmed} fontSize={11}>{ha ? ha.pct + '%' : 'total'}</text>
    </svg>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onMouseLeave={() => setHov(null)}>
      {arcs.map((a, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', opacity: hov !== null && hov !== i ? 0.4 : 1, transition: 'opacity 0.15s' }} onMouseEnter={() => setHov(i)}>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: a.color, flexShrink: 0 }} />
        <span style={{ color: hov === i ? COLORS.text : COLORS.muted, fontWeight: hov === i ? 600 : 400, transition: 'color 0.15s' }}>{a.label}</span>
        <span style={{ color: COLORS.text, fontWeight: 600, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{hov === i ? formatNumber(a.value) + ' (' + a.pct + '%)' : a.pct + '%'}</span>
      </div>)}
    </div>
  </div>;
});
