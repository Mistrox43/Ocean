import { useMemo, useState } from 'react';
import { COLORS } from '@/constants';
import { formatNumber, sortHeaderStyle, sortIcon } from '@/utils';
import { Bar, Donut, Gauge, KPI } from '@/components/charts';
import { fmtMonthLabel, mergeMonthBuckets } from '@/lib/intakeAnalytics';
import type {
  IntakeAnalytics,
  IntakeRecipientStat,
  IntakeView,
  SortDirection,
} from '@/types';

type LeftTab = 'wait1Recipient' | 'volumeByMonth' | 'methodBySender' | 'currentLocation';
type RightTab = 'volumeByReferrer' | 'currentLocation';
type RecipientSortField = 'recipientName' | 'avgWait1' | 'p90Wait1' | 'count';

interface CentralIntakeTabProps {
  intake: IntakeAnalytics;
  loadedAtLabel?: string;
}

const fmt1 = (v: number | null) => (v === null ? '—' : v.toFixed(1));
const fmt2 = (v: number | null) => (v === null ? '—' : v.toFixed(2));
const fmtPct = (v: number) => (v * 100).toFixed(1) + '%';

export function CentralIntakeTab({ intake, loadedAtLabel }: CentralIntakeTabProps) {
  const [fy, setFy] = useState<string>('');
  const [quarter, setQuarter] = useState<string>('');
  const [month, setMonth] = useState<string>('');
  const [week, setWeek] = useState<string>('');
  const [leftTab, setLeftTab] = useState<LeftTab>('wait1Recipient');
  const [rightTab, setRightTab] = useState<RightTab>('volumeByReferrer');
  const [recSort, setRecSort] = useState<{ field: RecipientSortField; dir: SortDirection }>({
    field: 'avgWait1',
    dir: 'desc',
  });

  const hasActiveFilter = !!(fy || quarter || month || week);

  // Cascade: clear lower selections when an upper one changes.
  const onSelectFy = (v: string) => {
    setFy(v);
    setQuarter('');
    setMonth('');
    setWeek('');
  };
  const onSelectQuarter = (v: string) => {
    setQuarter(v);
    setMonth('');
    setWeek('');
  };
  const onSelectMonth = (v: string) => {
    setMonth(v);
    setWeek('');
  };

  const view: IntakeView = useMemo(
    () => mergeMonthBuckets(intake, { fy, quarter, month, week }),
    [intake, fy, quarter, month, week],
  );

  const fyOptions = intake.fiscalYears;
  const quarterOptions = useMemo(() => {
    if (fy) return intake.quartersByFy[fy] || [];
    return Object.values(intake.quartersByFy).flat();
  }, [intake, fy]);
  const monthOptions = useMemo(() => {
    if (quarter) return intake.monthsByQuarter[quarter] || [];
    if (fy) {
      const out: string[] = [];
      for (const q of intake.quartersByFy[fy] || []) out.push(...(intake.monthsByQuarter[q] || []));
      return out;
    }
    return Object.keys(intake.byMonth).sort();
  }, [intake, fy, quarter]);
  const weekOptions = useMemo(() => {
    if (month) return intake.weeksByMonth[month] || [];
    return [];
  }, [intake, month]);

  const presence = intake.presence;
  const cycleVisible = presence.cycle;
  const ciProcessingVisible = presence.ciProcessing;
  const backlogVisible = presence.backlog;
  const wait1Visible = presence.wait1;
  const wait2Visible = presence.wait2;
  const preferenceVisible = presence.preference && Object.keys(view.patientPref).length > 0;
  const completeVisible = presence.complete && (view.completeCount + view.incompleteCount) > 0;

  const completeTotal = view.completeCount + view.incompleteCount;
  const completePct = completeTotal > 0 ? view.completeCount / completeTotal : 0;
  const completeSegments = [
    { label: 'COMPLETE', value: view.completeCount, color: COLORS.green },
    { label: 'INCOMPLETE', value: view.incompleteCount, color: COLORS.red },
  ];

  const prefSegments = useMemo(() => {
    const shortLabel: Record<string, string> = {
      'Specific Surgeon': 'Specific Surgeon',
      'First Available Surgeon': 'First Available',
      'Surgeon Closest to Patient Home': 'Closest to Home',
    };
    return Object.entries(view.patientPref)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({
        label: shortLabel[label] || label,
        value,
        color: [COLORS.purple, COLORS.accent, COLORS.amber, COLORS.green, COLORS.blue][i % 5],
      }));
  }, [view.patientPref]);

  const wait1GaugeMax = useMemo(() => {
    const m = view.p90Wait1 ?? view.avgWait1 ?? 0;
    return Math.max(60, Math.ceil(m / 10) * 10);
  }, [view.avgWait1, view.p90Wait1]);
  const wait2GaugeMax = useMemo(() => {
    const m = view.p90Wait2 ?? view.avgWait2 ?? 0;
    return Math.max(60, Math.ceil(m / 10) * 10);
  }, [view.avgWait2, view.p90Wait2]);

  return (
    <div>
      {/* Filter row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px repeat(4, 1fr) 140px',
          gap: 0,
          background: COLORS.card,
          border: '1px solid ' + COLORS.border,
          borderRadius: 12,
          marginBottom: 14,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderRight: '1px solid ' + COLORS.border }}>
          <div style={{ fontSize: 10, color: COLORS.dimmed, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>
            Data last refreshed
          </div>
          <div style={{ fontSize: 12, color: COLORS.text, marginTop: 4 }}>{loadedAtLabel || '—'}</div>
          <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
            {formatNumber(intake.totalProcessed)} rows
          </div>
        </div>
        <FilterCell label="Fiscal Year" value={fy} options={fyOptions} onChange={onSelectFy} />
        <FilterCell label="Quarter" value={quarter} options={quarterOptions} onChange={onSelectQuarter} />
        <FilterCell label="Month" value={month} options={monthOptions} onChange={onSelectMonth} formatLabel={fmtMonthLabel} />
        <FilterCell label="Week" value={week} options={weekOptions} onChange={setWeek} disabled={!month} />
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid ' + COLORS.border }}>
          {hasActiveFilter ? (
            <button
              onClick={() => {
                setFy('');
                setQuarter('');
                setMonth('');
                setWeek('');
              }}
              style={{
                fontSize: 11,
                color: COLORS.accent,
                background: 'transparent',
                border: '1px solid ' + COLORS.accent + '66',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Clear filters
            </button>
          ) : (
            <span style={{ fontSize: 11, color: COLORS.dimmed }}>All-time view</span>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 14 }}>
        <KPI label="# Referrals Processed" value={formatNumber(view.totalProcessed)} color={COLORS.accent} />
        <KPI
          label="# Unique Patients"
          value={view.uniquePatients === null ? '—' : formatNumber(view.uniquePatients)}
          sub={view.uniquePatients === null ? 'patientId not in export' : undefined}
          color={COLORS.green}
        />
        <KPI
          label="Avg Referral Processing Cycle (Days)"
          value={cycleVisible ? fmt1(view.avgCycleDays) : '—'}
          sub={cycleVisible ? undefined : 'no cycle data in export'}
          color={COLORS.purple}
        />
        <KPI
          label="# Referrals included in Wait 1"
          value={wait1Visible ? formatNumber(view.wait1Count) : '—'}
          sub={wait1Visible ? undefined : 'no wait1 data in export'}
          color={COLORS.amber}
        />
        <KPI
          label="# Referrals included in Wait 2"
          value={wait2Visible ? formatNumber(view.wait2Count) : '—'}
          sub={wait2Visible ? undefined : 'no wait2 data in export'}
          color={COLORS.blue}
        />
      </div>

      {ciProcessingVisible && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
          <KPI
            label="CI Processing Time — Median"
            value={fmt1(view.ciProcessingMedian)}
            sub={`${formatNumber(view.ciProcessingCount)} closed`}
            color={COLORS.purple}
          />
          <KPI
            label="CI Processing Time — P75"
            value={fmt1(view.ciProcessingP75)}
            color={COLORS.amber}
          />
          <KPI
            label="CI Processing Time — P90"
            value={fmt1(view.ciProcessingP90)}
            color={COLORS.red}
          />
        </div>
      )}

      {backlogVisible && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', gap: 16, marginBottom: 14 }}>
          <ChartBox title="Days at CI (Backlog)" subtitle={`as of ${view.backlogReferenceDate || '—'}`}>
            <div style={{ fontSize: 28, fontWeight: 800, color: COLORS.red }}>
              {formatNumber(view.backlogCount)}
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
              open referrals · avg {fmt1(view.backlogAvgDays)} days
            </div>
          </ChartBox>
          <ChartBox title="Backlog Age Distribution">
            {view.backlogHistogram.length > 0 ? (
              <Bar data={view.backlogHistogram} color={COLORS.red} height={180} />
            ) : (
              <EmptyState text="No open referrals at CI in selected window." />
            )}
          </ChartBox>
          <ChartBox title="Backlog by Referral State">
            <SimpleTable
              columns={[
                { key: 'referralState', label: 'Referral State' },
                { key: 'count', label: '# Open', numeric: true, format: (v) => formatNumber(v as number) },
                { key: 'avgDays', label: 'Avg Days', numeric: true, format: (v) => fmt1(v as number | null) },
              ]}
              rows={view.backlogByState}
            />
          </ChartBox>
        </div>
      )}

      {/* Chart row — donuts get 2 cols each, gauges 1 col each, on a 6-col grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 2fr 1fr 1fr',
          gap: 16,
          marginBottom: 14,
        }}
      >
        {completeVisible && (
          <ChartBox title="Referrals Received Complete" subtitle={`${fmtPct(completePct)} complete · ${formatNumber(completeTotal)} total`}>
            <Donut size={140} segments={completeSegments} />
          </ChartBox>
        )}
        {preferenceVisible && (
          <ChartBox title="Patient Preference">
            <Donut size={140} segments={prefSegments} />
          </ChartBox>
        )}
        {wait1Visible && (
          <ChartBox title="Wait 1">
            <Gauge value={view.avgWait1} max={wait1GaugeMax} label="Avg" unit="days" />
          </ChartBox>
        )}
        {wait2Visible && (
          <ChartBox title="Wait 2">
            <Gauge value={view.avgWait2} max={wait2GaugeMax} label="Avg" unit="days" />
          </ChartBox>
        )}
      </div>

      {/* Bottom split */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        {/* Left panel */}
        <div
          style={{
            background: COLORS.card,
            border: '1px solid ' + COLORS.border,
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 380,
          }}
        >
          <InnerTabBar>
            <InnerTab active={leftTab === 'wait1Recipient'} onClick={() => setLeftTab('wait1Recipient')}>
              Wait 1 Avg & 90th Percentile
            </InnerTab>
            <InnerTab active={leftTab === 'volumeByMonth'} onClick={() => setLeftTab('volumeByMonth')}>
              Referral Volume
            </InnerTab>
            <InnerTab active={leftTab === 'methodBySender'} onClick={() => setLeftTab('methodBySender')}>
              Method Sent by Sender
            </InnerTab>
            <InnerTab active={leftTab === 'currentLocation'} onClick={() => setLeftTab('currentLocation')}>
              Current Referral Location
            </InnerTab>
          </InnerTabBar>
          <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {leftTab === 'wait1Recipient' && (
              <RecipientWaitTable
                rows={view.recipientStats}
                view={view}
                wait1Available={wait1Visible}
                sort={recSort}
                onSort={(field) =>
                  setRecSort((prev) =>
                    prev.field === field
                      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                      : { field, dir: 'desc' },
                  )
                }
              />
            )}
            {leftTab === 'volumeByMonth' && (
              <>
                <PanelTitle>Referral Volume by Month</PanelTitle>
                <div style={{ flex: 1, minHeight: 0 }}>
                  {view.volumeByMonth.length > 0 ? (
                    <Bar data={view.volumeByMonth} color={COLORS.accent} height={300} />
                  ) : (
                    <EmptyState text="No referrals in selected window." />
                  )}
                </div>
              </>
            )}
            {leftTab === 'methodBySender' && (
              <>
                <PanelTitle>Method Sent by Sender</PanelTitle>
                {!presence.source ? (
                  <EmptyState text="referralSource not in export." />
                ) : (
                  <SimpleTable
                    columns={[
                      { key: 'method', label: 'Sent Type' },
                      { key: 'count', label: '# of Referrals', numeric: true, format: (v) => formatNumber(v as number) },
                      { key: 'pct', label: '% Referrals', numeric: true, format: (v) => fmtPct(v as number) },
                      { key: 'referrerCount', label: '# of Referrers', numeric: true, format: (v) => formatNumber(v as number) },
                    ]}
                    rows={view.methodBySender}
                  />
                )}
              </>
            )}
            {leftTab === 'currentLocation' && (
              <>
                <PanelTitle>Current Referral Location</PanelTitle>
                <SimpleTable
                  columns={[
                    { key: 'recipientName', label: 'Recipient Name' },
                    { key: 'count', label: '# Referrals', numeric: true, format: (v) => formatNumber(v as number) },
                  ]}
                  rows={view.currentLocation}
                  totalsRow={{
                    recipientName: 'Totals',
                    count: view.currentLocation.reduce((s, r) => s + r.count, 0),
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div
          style={{
            background: COLORS.card,
            border: '1px solid ' + COLORS.border,
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 380,
          }}
        >
          <InnerTabBar>
            <InnerTab active={rightTab === 'volumeByReferrer'} onClick={() => setRightTab('volumeByReferrer')}>
              Referral Volume by Referrer
            </InnerTab>
            <InnerTab active={rightTab === 'currentLocation'} onClick={() => setRightTab('currentLocation')}>
              Current Referral Location
            </InnerTab>
          </InnerTabBar>
          <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {rightTab === 'volumeByReferrer' && (
              <>
                <PanelTitle>Referral Volume by Referrer Name</PanelTitle>
                {!presence.referrer ? (
                  <EmptyState text="referrerName not in export." />
                ) : (
                  <SimpleTable
                    columns={[
                      { key: 'name', label: 'Referrer Name' },
                      { key: 'display', label: '# of Referrals', numeric: true },
                    ]}
                    rows={view.referrerCounts}
                    totalsRow={{
                      name: 'TOTALS',
                      display: formatNumber(view.totalProcessed),
                    }}
                  />
                )}
              </>
            )}
            {rightTab === 'currentLocation' && (
              <>
                <PanelTitle>Current Referral Location</PanelTitle>
                <SimpleTable
                  columns={[
                    { key: 'recipientName', label: 'Recipient Name' },
                    { key: 'count', label: '# Referrals', numeric: true, format: (v) => formatNumber(v as number) },
                  ]}
                  rows={view.currentLocation}
                  totalsRow={{
                    recipientName: 'Totals',
                    count: view.currentLocation.reduce((s, r) => s + r.count, 0),
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface FilterCellProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  formatLabel?: (v: string) => string;
  disabled?: boolean;
}

function FilterCell({ label, value, options, onChange, formatLabel, disabled }: FilterCellProps) {
  return (
    <div style={{ padding: '12px 14px', borderRight: '1px solid ' + COLORS.border }}>
      <div style={{ fontSize: 10, color: COLORS.dimmed, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%',
          marginTop: 4,
          background: 'transparent',
          color: disabled ? COLORS.dimmed : COLORS.text,
          border: 'none',
          outline: 'none',
          fontSize: 12,
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: 0,
        }}
      >
        <option value="" style={{ background: COLORS.card }}>(All)</option>
        {options.map((o) => (
          <option key={o} value={o} style={{ background: COLORS.card }}>
            {formatLabel ? formatLabel(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChartBox({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: '1px solid ' + COLORS.border,
        borderRadius: 12,
        padding: 24,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: subtitle ? 2 : 12, marginTop: 0 }}>{title}</h3>
      {subtitle && <p style={{ fontSize: 11, color: COLORS.dimmed, marginBottom: 12, marginTop: 0 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function InnerTabBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        background: COLORS.background,
        borderBottom: '1px solid ' + COLORS.border,
        overflowX: 'auto',
      }}
    >
      {children}
    </div>
  );
}

function InnerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px',
        fontSize: 12,
        fontWeight: 600,
        color: active ? COLORS.accent : COLORS.muted,
        background: active ? COLORS.card : 'transparent',
        border: 'none',
        borderBottom: '2px solid ' + (active ? COLORS.accent : 'transparent'),
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 12 }}>{children}</div>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: COLORS.dimmed,
        fontSize: 12,
        fontStyle: 'italic',
        minHeight: 200,
      }}
    >
      {text}
    </div>
  );
}

interface RecipientWaitTableProps {
  rows: IntakeRecipientStat[];
  view: IntakeView;
  wait1Available: boolean;
  sort: { field: RecipientSortField; dir: SortDirection };
  onSort: (field: RecipientSortField) => void;
}

function RecipientWaitTable({ rows, view, wait1Available, sort, onSort }: RecipientWaitTableProps) {
  const sorted = useMemo(() => {
    const arr = rows.slice();
    arr.sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (av === null && bv === null) cmp = 0;
      else if (av === null) cmp = 1;
      else if (bv === null) cmp = -1;
      else cmp = String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort]);

  if (!wait1Available) return <EmptyState text="Wait 1 not available — neither wait1Days nor scheduledAppointment present in export." />;

  return (
    <>
      <PanelTitle>Wait 1 Average &amp; 90th Percentile</PanelTitle>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: COLORS.card, zIndex: 1 }}>
            <tr style={{ borderBottom: '2px solid ' + COLORS.border }}>
              <th style={sortHeaderStyle(sort.field, 'recipientName', COLORS.border)} onClick={() => onSort('recipientName')}>
                Recipient Name{sortIcon(sort.field, sort.dir, 'recipientName')}
              </th>
              <th
                style={{ ...sortHeaderStyle(sort.field, 'avgWait1', COLORS.border), textAlign: 'right' }}
                onClick={() => onSort('avgWait1')}
              >
                Average{sortIcon(sort.field, sort.dir, 'avgWait1')}
              </th>
              <th
                style={{ ...sortHeaderStyle(sort.field, 'p90Wait1', COLORS.border), textAlign: 'right' }}
                onClick={() => onSort('p90Wait1')}
              >
                90th Percentile{sortIcon(sort.field, sort.dir, 'p90Wait1')}
              </th>
              <th
                style={{ ...sortHeaderStyle(sort.field, 'count', COLORS.border), textAlign: 'right' }}
                onClick={() => onSort('count')}
              >
                # Referrals{sortIcon(sort.field, sort.dir, 'count')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: COLORS.border + '33', fontWeight: 700 }}>
              <td style={{ padding: '8px 10px', color: COLORS.text }}>Totals</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: COLORS.text }}>{fmt2(view.avgWait1)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: COLORS.text }}>{fmt1(view.p90Wait1)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: COLORS.text }}>{formatNumber(view.wait1Count)}</td>
            </tr>
            {sorted.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid ' + COLORS.border + '22' }}>
                <td style={{ padding: '6px 10px', color: COLORS.text, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.recipientName}>
                  {r.recipientName}
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: COLORS.text, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt2(r.avgWait1)}
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: COLORS.text, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt1(r.p90Wait1)}
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {formatNumber(r.count)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 20, textAlign: 'center', color: COLORS.dimmed, fontSize: 11 }}>
                  No referrals in selected window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: COLORS.muted }}>
        Wait 1 = days from referral creation to first scheduled appointment.
      </div>
    </>
  );
}

interface SimpleTableColumn<T> {
  key: keyof T & string;
  label: string;
  numeric?: boolean;
  format?: (v: unknown, row: T) => React.ReactNode;
}

interface SimpleTableProps<T> {
  columns: SimpleTableColumn<T>[];
  rows: T[];
  totalsRow?: Record<string, unknown>;
}

function SimpleTable<T extends object>({ columns, rows, totalsRow }: SimpleTableProps<T>) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead style={{ position: 'sticky', top: 0, background: COLORS.card, zIndex: 1 }}>
          <tr style={{ borderBottom: '2px solid ' + COLORS.border }}>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  padding: '8px 10px',
                  textAlign: c.numeric ? 'right' : 'left',
                  color: COLORS.dimmed,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {totalsRow && (
            <tr style={{ background: COLORS.border + '33', fontWeight: 700 }}>
              {columns.map((c) => {
                const v = (totalsRow as Record<string, unknown>)[c.key];
                return (
                  <td key={c.key} style={{ padding: '8px 10px', textAlign: c.numeric ? 'right' : 'left', color: COLORS.text }}>
                    {c.format ? c.format(v, totalsRow as T) : (v as React.ReactNode) ?? ''}
                  </td>
                );
              })}
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid ' + COLORS.border + '22' }}>
              {columns.map((c) => {
                const v = (r as Record<string, unknown>)[c.key];
                return (
                  <td
                    key={c.key}
                    style={{
                      padding: '6px 10px',
                      textAlign: c.numeric ? 'right' : 'left',
                      color: COLORS.text,
                      fontVariantNumeric: c.numeric ? 'tabular-nums' : 'normal',
                      maxWidth: 260,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={typeof v === 'string' ? v : undefined}
                  >
                    {c.format ? c.format(v, r) : (v as React.ReactNode) ?? ''}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ padding: 20, textAlign: 'center', color: COLORS.dimmed, fontSize: 11 }}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

