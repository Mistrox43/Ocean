import { useState, useCallback, memo } from 'react';
import { COLORS } from '@/constants';
import { Progress } from '@/components/ui/progress';
import type { ParseProgress } from '@/hooks/useFileParser';

interface UploadProps {
  label: string;
  desc: string;
  loaded: boolean;
  error?: string;
  onError?: (message: string) => void;
  isLoading?: boolean;
  progress?: ParseProgress | null;
  onLoad?: (buf: ArrayBuffer) => void;
  onFile?: (file: File) => void;
}

const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export const Upload = memo(function Upload({ label, desc, loaded, error, onError, onLoad, onFile, isLoading, progress }: UploadProps) {
  const [drag, setDrag] = useState(false);
  const go = useCallback((file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if ((ext === 'xlsx' || ext === 'xls') && file.size >= LARGE_FILE_BYTES) {
      onError?.('This file is too large for XLSX format. Please export as CSV and re-upload.');
      return;
    }
    if (onFile) {
      onFile(file);
      return;
    }
    const r = new FileReader();
    r.onerror = () => onError?.('Unable to read file. Please try again with a fresh export.');
    r.onload = (e) => { if (e.target?.result && onLoad) onLoad(e.target.result as ArrayBuffer); };
    r.readAsArrayBuffer(file);
  }, [onError, onFile, onLoad]);
  return <div
    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
    onDragLeave={() => setDrag(false)}
    onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) go(e.dataTransfer.files[0]); }}
    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = () => { if (inp.files?.[0]) go(inp.files[0]); }; inp.click(); }}
    style={{ background: error ? COLORS.red + '18' : loaded ? COLORS.greenGlow : drag ? COLORS.accentGlow : COLORS.card, border: '2px dashed ' + (error ? COLORS.red : loaded ? COLORS.green : drag ? COLORS.accent : COLORS.border), borderRadius: 10, padding: '20px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <span style={{ fontSize: 28 }}>{error ? '\u26A0\uFE0F' : loaded ? '\u2713' : isLoading ? '\u23F3' : '\uD83D\uDCC4'}</span>
    <span style={{ fontSize: 14, fontWeight: 700, color: error ? COLORS.red : loaded ? COLORS.green : COLORS.text }}>{label}</span>
    <span style={{ fontSize: 11, color: error ? COLORS.red : COLORS.dimmed, textAlign: 'center' }}>{error || (isLoading ? progress?.stage || 'Processing file...' : loaded ? 'Loaded successfully' : desc)}</span>
    {isLoading && <div style={{ width: '100%', marginTop: 8 }}>
      <Progress value={progress?.pct || 0} style={{ height: 6, background: COLORS.border }} />
      <div style={{ marginTop: 4, fontSize: 10, color: COLORS.dimmed, textAlign: 'center' }}>
        {(progress?.pct || 0).toFixed(1)}% {progress?.total ? `(${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()})` : ''}
      </div>
    </div>}
  </div>;
});
