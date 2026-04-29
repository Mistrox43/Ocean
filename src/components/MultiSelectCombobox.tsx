import { useState, useRef, useEffect } from 'react';
import { COLORS } from '@/constants';

interface Option {
  ref: string;
  title: string;
}

interface Props {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  width?: number;
}

export function MultiSelectCombobox({ options, value, onChange, placeholder = 'All', width = 240 }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = search.trim()
    ? options.filter(o => o.ref.toLowerCase().includes(search.toLowerCase()) || o.title.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (ref: string) => {
    onChange(value.includes(ref) ? value.filter(v => v !== ref) : [...value, ref]);
  };

  const active = value.length > 0;
  const label = active ? (value.length === 1 ? (options.find(o => o.ref === value[0])?.ref ?? value[0]) : `${value.length} selected`) : placeholder;

  return (
    <div ref={containerRef} style={{ position: 'relative', width }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', height: 32, padding: '0 10px', borderRadius: 6, fontSize: 12,
          background: COLORS.card, border: '1px solid ' + (active ? COLORS.accent : COLORS.border),
          color: active ? COLORS.accent : COLORS.text, cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label}</span>
        <span style={{ color: COLORS.dimmed, fontSize: 10, flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4,
          width: Math.max(width, 280), background: COLORS.card,
          border: '1px solid ' + COLORS.border, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ padding: '8px 8px 4px' }}>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='Search...'
              style={{
                width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 5,
                background: COLORS.background, border: '1px solid ' + COLORS.border,
                color: COLORS.text, fontSize: 12, outline: 'none',
              }}
            />
          </div>

          {active && (
            <div style={{ padding: '2px 8px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: COLORS.dimmed }}>{value.length} selected</span>
              <button
                onClick={() => onChange([])}
                style={{ fontSize: 11, color: COLORS.accent, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              >
                Clear all
              </button>
            </div>
          )}

          <div style={{ maxHeight: 260, overflowY: 'auto', padding: '2px 4px 6px' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: COLORS.dimmed, textAlign: 'center' }}>No matches</div>
            )}
            {filtered.map(o => {
              const checked = value.includes(o.ref);
              return (
                <div
                  key={o.ref}
                  onClick={() => toggle(o.ref)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 5,
                    cursor: 'pointer', background: checked ? COLORS.accent + '18' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = COLORS.border + '66'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = checked ? COLORS.accent + '18' : 'transparent'; }}
                >
                  <div style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    border: '1.5px solid ' + (checked ? COLORS.accent : COLORS.muted),
                    background: checked ? COLORS.accent : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {checked && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 12, color: checked ? COLORS.accent : COLORS.text, fontFamily: "'JetBrains Mono'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.ref}</div>
                    {o.title !== o.ref && <div style={{ fontSize: 11, color: COLORS.dimmed, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.title}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
