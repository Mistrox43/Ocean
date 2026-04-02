import React, { useState } from 'react';
import { COLORS } from '@/constants';
import { formatNumber } from '@/utils';

interface MiniBarProps {
  data: { label: string; primary: number; secondary?: number }[];
  height?: number;
  color?: string;
  stacked?: boolean;
}

export const MiniBar = React.memo(function MiniBar({ data, height = 140, color = COLORS.accent, stacked }: MiniBarProps) {
  const [hov, setHov] = useState<number | null>(null);
  const mx = Math.max(...data.map(d => d.primary + (d.secondary || 0)), 1);
  const lStep = Math.max(1, Math.floor(data.length / 6));
  return <div style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height, position: 'relative' }} onMouseLeave={() => setHov(null)}>
      {data.map((d, i) => { const tot = d.primary + (d.secondary || 0); return <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', cursor: 'default', opacity: hov !== null && hov !== i ? 0.4 : 1, transition: 'opacity 0.15s' }} onMouseEnter={() => setHov(i)}>
        {hov === i && <span style={{ fontSize: 8, color: COLORS.text, marginBottom: 1, fontWeight: 700 }}>{formatNumber(tot)}</span>}
        <div style={{ width: '100%', borderRadius: '2px 2px 0 0', height: Math.max((d.primary / mx) * 100, 0.5) + '%', background: color }} />
        {stacked && (d.secondary || 0) > 0 && <div style={{ width: '100%', height: Math.max(((d.secondary || 0) / mx) * 100, 0.5) + '%', background: COLORS.amber }} />}
      </div>; })}
      {hov !== null && hov >= 0 && hov < data.length && <div style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', background: COLORS.card, border: '1px solid ' + COLORS.border, borderRadius: 6, padding: '3px 10px', fontSize: 10, color: COLORS.text, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 5, pointerEvents: 'none' }}>
        {data[hov].label} — {formatNumber(data[hov].primary + (data[hov].secondary || 0))}{stacked && data[hov].secondary ? ' (' + formatNumber(data[hov].secondary || 0) + ' test)' : ''}
      </div>}
    </div>
    <div style={{ display: 'flex', gap: 1, marginTop: 4 }}>
      {data.map((d, i) => <div key={i} style={{ flex: 1, textAlign: 'center' }}>{(hov === i || i % lStep === 0) ? <span style={{ fontSize: 7, color: hov === i ? COLORS.text : COLORS.dimmed, whiteSpace: 'nowrap', fontWeight: hov === i ? 600 : 400 }}>{d.label.substring(5)}</span> : null}</div>)}
    </div>
  </div>;
});
