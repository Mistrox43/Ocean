import { memo } from 'react';
import { COLORS } from '@/constants';
import { formatNumber, percentage } from '@/utils';

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

interface FunnelProps {
  steps: FunnelStep[];
}

export const Funnel = memo(function Funnel({ steps }: FunnelProps) {
  const mx = Math.max(...steps.map(s => s.value), 1);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {steps.map((s, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 150, fontSize: 12, color: COLORS.muted, textAlign: 'right', flexShrink: 0 }}>{s.label}</div>
      <div style={{ flex: 1, height: 28, background: COLORS.border, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div style={{ height: '100%', width: (s.value / mx) * 100 + '%', borderRadius: 4, background: 'linear-gradient(90deg,' + s.color + 'cc,' + s.color + ')' }} />
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 700, color: '#fff' }}>{formatNumber(s.value)} {i > 0 ? '(' + percentage(s.value, steps[0].value) + '%)' : ''}</span>
      </div>
    </div>)}
  </div>;
});
