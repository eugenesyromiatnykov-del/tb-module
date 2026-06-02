import { relativeAgo } from '@/lib/date-utils';
import { formatDateUk } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

// Per-row sync freshness cell. Slate dot + relative-time label.
// Hover gives the absolute date in a native tooltip.
//
// Tone:
//   • <7 дн  → green
//   • <30 дн → slate
//   • <90 дн → orange
//   • ≥90 дн or never → red
export function SyncCell({ at }: { at: string | null | undefined }) {
  if (!at) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-red-700"
        title="Жодного разу не синхронізовано"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        ніколи
      </span>
    );
  }
  const ageDays = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  let cls = 'text-slate-600';
  let dot = 'bg-slate-400';
  if (ageDays < 7) { cls = 'text-green-700'; dot = 'bg-green-500'; }
  else if (ageDays < 30) { cls = 'text-slate-600'; dot = 'bg-slate-400'; }
  else if (ageDays < 90) { cls = 'text-orange-700'; dot = 'bg-orange-500'; }
  else { cls = 'text-red-700'; dot = 'bg-red-500'; }
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs', cls)}
      title={`Останній sync: ${formatDateUk(at.slice(0, 10))}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {relativeAgo(at)}
    </span>
  );
}
