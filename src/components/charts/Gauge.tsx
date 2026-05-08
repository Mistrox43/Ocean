import { memo } from 'react';
import { COLORS } from '@/constants';

interface GaugeProps {
  value: number | null;
  max?: number;
  label?: string;
  unit?: string;
  thresholds?: { good: number; warn: number };
  size?: number;
}

export const Gauge = memo(function Gauge({
  value,
  max = 60,
  label = 'Avg',
  unit = 'days',
  thresholds = { good: 14, warn: 30 },
  size = 220,
}: GaugeProps) {
  const cx = 120;
  const cy = 120;
  const r = 88;

  const polar = (frac: number) => {
    const ang = -Math.PI + frac * Math.PI;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };

  const arcPath = (start: number, end: number) => {
    const [x1, y1] = polar(start);
    const [x2, y2] = polar(end);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };

  const effectiveMax = value !== null && value > max ? Math.ceil(value / 10) * 10 : max;
  const goodFrac = Math.min(1, thresholds.good / effectiveMax);
  const warnFrac = Math.min(1, thresholds.warn / effectiveMax);
  const clamped = value === null ? null : Math.max(0, Math.min(effectiveMax, value));
  const valueFrac = clamped === null ? 0 : clamped / effectiveMax;

  const pointerColor = value === null
    ? COLORS.dimmed
    : valueFrac < goodFrac
      ? COLORS.green
      : valueFrac < warnFrac
        ? COLORS.amber
        : COLORS.red;

  const angle = -90 + valueFrac * 180;

  const tickFrac = [0, goodFrac, warnFrac, 1];
  const tickInner = r - 4;
  const tickOuter = r + 4;
  const tickLine = (frac: number) => {
    const ang = -Math.PI + frac * Math.PI;
    const x1 = cx + tickInner * Math.cos(ang);
    const y1 = cy + tickInner * Math.sin(ang);
    const x2 = cx + tickOuter * Math.cos(ang);
    const y2 = cy + tickOuter * Math.sin(ang);
    return { x1, y1, x2, y2 };
  };

  const valueText = value === null ? '—' : value.toFixed(1);

  return (
    <svg viewBox="0 0 240 150" width="100%" height={size * 0.625} preserveAspectRatio="xMidYMid meet">
      {/* Background track */}
      <path d={arcPath(0, 1)} fill="none" stroke={COLORS.border} strokeWidth={14} strokeLinecap="butt" />
      {value !== null && (
        <>
          <path d={arcPath(0, goodFrac)} fill="none" stroke={COLORS.green} strokeWidth={14} strokeLinecap="butt" opacity={0.85} />
          <path d={arcPath(goodFrac, warnFrac)} fill="none" stroke={COLORS.amber} strokeWidth={14} strokeLinecap="butt" opacity={0.85} />
          <path d={arcPath(warnFrac, 1)} fill="none" stroke={COLORS.red} strokeWidth={14} strokeLinecap="butt" opacity={0.85} />
        </>
      )}

      {/* Tick marks at 0, good, warn, max */}
      {tickFrac.map((f, i) => {
        const t = tickLine(f);
        return (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={COLORS.muted}
            strokeWidth={1.2}
            opacity={0.7}
          />
        );
      })}

      {/* Pointer (teardrop) */}
      {value !== null && (
        <g transform={`rotate(${angle.toFixed(2)} ${cx} ${cy})`}>
          <path
            d={`M ${cx} ${cy - r + 4} Q ${cx - 6} ${cy - 6} ${cx} ${cy} Q ${cx + 6} ${cy - 6} ${cx} ${cy - r + 4} Z`}
            fill={pointerColor}
            stroke={COLORS.text}
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <circle cx={cx} cy={cy} r={6} fill={COLORS.card} stroke={pointerColor} strokeWidth={2} />
        </g>
      )}

      {/* Value readout */}
      <text x={cx} y={cy - 10} textAnchor="middle" fill={COLORS.text} fontSize={26} fontWeight={700} style={{ fontVariantNumeric: 'tabular-nums' as const }}>
        {valueText}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill={COLORS.muted} fontSize={11}>
        {label}{unit ? ` · ${unit}` : ''}
      </text>

      {/* Scale labels */}
      <text x={cx - r - 4} y={cy + 18} textAnchor="middle" fill={COLORS.dimmed} fontSize={10}>0</text>
      <text x={cx + r + 4} y={cy + 18} textAnchor="middle" fill={COLORS.dimmed} fontSize={10}>{Math.round(effectiveMax)}</text>
    </svg>
  );
});
