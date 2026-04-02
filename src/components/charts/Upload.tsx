import { useState, useCallback, memo } from 'react';
import { COLORS } from '@/constants';

interface UploadProps {
  label: string;
  desc: string;
  loaded: boolean;
  onLoad: (buf: ArrayBuffer) => void;
}

export const Upload = memo(function Upload({ label, desc, loaded, onLoad }: UploadProps) {
  const [drag, setDrag] = useState(false);
  const go = useCallback((file: File) => {
    const r = new FileReader();
    r.onload = (e) => { if (e.target?.result) onLoad(e.target.result as ArrayBuffer); };
    r.readAsArrayBuffer(file);
  }, [onLoad]);
  return <div
    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
    onDragLeave={() => setDrag(false)}
    onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) go(e.dataTransfer.files[0]); }}
    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = () => { if (inp.files?.[0]) go(inp.files[0]); }; inp.click(); }}
    style={{ background: loaded ? COLORS.greenGlow : drag ? COLORS.accentGlow : COLORS.card, border: '2px dashed ' + (loaded ? COLORS.green : drag ? COLORS.accent : COLORS.border), borderRadius: 10, padding: '20px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <span style={{ fontSize: 28 }}>{loaded ? '\u2713' : '\uD83D\uDCC4'}</span>
    <span style={{ fontSize: 14, fontWeight: 700, color: loaded ? COLORS.green : COLORS.text }}>{label}</span>
    <span style={{ fontSize: 11, color: COLORS.dimmed, textAlign: 'center' }}>{loaded ? 'Loaded successfully' : desc}</span>
  </div>;
});
