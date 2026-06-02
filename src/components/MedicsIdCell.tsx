import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

// Compact, click-to-copy badge for the Medics ID cell. Stops propagation
// so the parent <tr onClick="open patient"> doesn't fire when the doctor
// is just grabbing the ID. Brief "✓" feedback for ~1.2s on success.
export function MedicsIdCell({ id }: { id: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!id) return <span className="text-slate-400">—</span>;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // navigator.clipboard can fail in iframes / insecure origins; fall back
      // to the legacy execCommand path.
      const ta = document.createElement('textarea');
      ta.value = id;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title="Клік щоб скопіювати"
      className={cn(
        'inline-flex items-center gap-1 rounded font-mono text-xs transition-colors',
        copied ? 'text-green-700' : 'text-slate-600 hover:text-blue-700',
      )}
    >
      <span>{id}</span>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-50" />}
    </button>
  );
}
