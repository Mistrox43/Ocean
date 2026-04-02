import { useState, memo } from 'react';
import { COLORS } from '@/constants';
import { formatNumber } from '@/utils';

interface AreaDataPoint {
  label: string;
  value: number;
  cumulative: number;
}

interface AreaProps {
  data: AreaDataPoint[];
  height?: number;
  color?: string;
}

export const Area = memo(function Area({ data, height = 200, color = COLORS.accent }: AreaProps) {
  const [hov, setHov] = useState<number | null>(null);
  if (!data.length) return null;
  const mv = Math.max(...data.map(d => d.cumulative), 1);
  const W = 700, H = height, L = 50, R = 20, T = 20, B = 40, pW = W - L - R, pH = H - T - B;
  const pts = data.map((d, i) => ({ x: L + (i / Math.max(data.length - 1, 1)) * pW, y: T + pH - (d.cumulative / mv) * pH, ...d }));
  const lp = pts.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p.x + ' ' + p.y).join(' ');
  const ap = lp + ' L ' + pts[pts.length - 1].x + ' ' + (T + pH) + ' L ' + pts[0].x + ' ' + (T + pH) + ' Z';
  const gl = [0, .25, .5, .75, 1].map(f => ({ y: T + pH - f * pH, label: Math.round(f * mv) }));
  const ls2 = Math.max(1, Math.floor(data.length / 12));
  const hp = hov !== null && hov >= 0 && hov < pts.length ? pts[hov] : null;
  return <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height }} onMouseLeave={() => setHov(null)}>
    <defs><linearGradient id='aG' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stopColor={color} stopOpacity={0.25} /><stop offset='100%' stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
    {gl.map((g, i) => <g key={i}><line x1={L} y1={g.y} x2={W - R} y2={g.y} stroke={COLORS.border} strokeWidth={1} /><text x={L - 8} y={g.y + 4} textAnchor='end' fill={COLORS.dimmed} fontSize={10}>{g.label}</text></g>)}
    <path d={ap} fill='url(#aG)' /><path d={lp} fill='none' stroke={color} strokeWidth={2} />
    {pts.map((p, i) => i % ls2 === 0 ? <text key={'l' + i} x={p.x} y={T + pH + 20} textAnchor='middle' fill={COLORS.dimmed} fontSize={9}>{p.label}</text> : null)}
    {pts.map((p, i) => <rect key={'h' + i} x={p.x - (pW / data.length) / 2} y={T} width={pW / data.length} height={pH} fill='transparent' style={{ cursor: 'crosshair' }} onMouseEnter={() => setHov(i)} />)}
    {hp && <>
      <line x1={hp.x} y1={T} x2={hp.x} y2={T + pH} stroke={COLORS.muted} strokeWidth={1} strokeDasharray='4 3' opacity={0.5} />
      <circle cx={hp.x} cy={hp.y} r={4} fill={color} stroke='#fff' strokeWidth={2} />
      <rect x={Math.min(hp.x - 55, W - R - 110)} y={Math.max(hp.y - 44, T)} width={110} height={38} rx={6} fill={COLORS.card} stroke={COLORS.border} strokeWidth={1} />
      <text x={Math.min(hp.x - 55, W - R - 110) + 55} y={Math.max(hp.y - 44, T) + 16} textAnchor='middle' fill={COLORS.text} fontSize={12} fontWeight={700}>{formatNumber(hp.cumulative)}</text>
      <text x={Math.min(hp.x - 55, W - R - 110) + 55} y={Math.max(hp.y - 44, T) + 30} textAnchor='middle' fill={COLORS.dimmed} fontSize={10}>{hp.label} (+{formatNumber(hp.value)})</text>
    </>}
  </svg>;
});
