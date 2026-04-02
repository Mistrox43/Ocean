import React, { useState } from 'react';
import { COLORS } from '@/constants';

interface BarProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
}

export const Bar = React.memo(function Bar({ data, height = 220, color = COLORS.accent }: BarProps) {
  const [hov, setHov] = useState<number | null>(null);
  const mx = Math.max(...data.map(d => d.value), 1);
  const lStep = data.length > 16 ? Math.ceil(data.length / 8) : data.length > 10 ? 2 : 1;
  const vStep = data.length > 20 ? Math.ceil(data.length / 10) : data.length > 12 ? 2 : 1;
  return <div style={{ display: 'flex', alignItems: 'flex-end', gap: data.length > 16 ? 2 : 6, height, padding: '8px 0', position: 'relative' }} onMouseLeave={() => setHov(null)}>
    {data.map((d, i) => <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', cursor: 'default' }} onMouseEnter={() => setHov(i)}>
      {(hov === i || i % vStep === 0) && <span style={{ fontSize: hov === i ? 10 : (data.length > 16 ? 9 : 11), color: hov === i ? color : COLORS.text, marginBottom: 2, fontWeight: hov === i ? 700 : 600 }}>{d.value > 0 ? d.value : ''}</span>}
      <div style={{ width: '100%', maxWidth: 48, borderRadius: '4px 4px 0 0', height: Math.max((d.value / mx) * 100, 2) + '%', background: hov === i ? color : 'linear-gradient(180deg,' + color + ',' + color + '88)', opacity: hov !== null && hov !== i ? 0.5 : 1, transition: 'opacity 0.15s' }} />
      {(hov === i || i % lStep === 0) ? <span style={{ fontSize: data.length > 16 ? 8 : 10, color: hov === i ? COLORS.text : COLORS.dimmed, marginTop: 4, textAlign: 'center', lineHeight: 1.2, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: hov === i ? 600 : 400 }}>{d.label}</span> : <span style={{ marginTop: 4, fontSize: 1 }}>&nbsp;</span>}
    </div>)}
  </div>;
});
