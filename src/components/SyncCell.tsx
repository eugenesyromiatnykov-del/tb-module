import { Loader2, RefreshCw } from 'lucide-react';
import { relativeAgo, formatDateUk } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { useSinglePatientSync } from '@/hooks/useSinglePatientSync';

// Per-row sync freshness cell. Slate dot + relative-time label.
// Hover gives the absolute date in a native tooltip.
//
// Tone:
//   • <7 дн  → green
//   • <30 дн → slate
//   • <90 дн → orange
//   • ≥90 дн or never → red
//
// When `medicsId` is provided the pill is also a button: click triggers a
// 1-patient sync_job (subset scope) — the extension picks it up, opens
// /doctors/journal, analyzes, closes the medics.ua tabs, and the freshness
// label refreshes itself via react-query invalidation.
export function SyncCell({
  at,
  medicsId,
}: {
  at: string | null | undefined;
  medicsId?: string | null;
}) {
  const sync = useSinglePatientSync(medicsId ?? null);
  const interactive = !!medicsId;

  // Busy = our specific subset-of-1 job is in flight.
  if (interactive && sync.busy) {
    return (
      <Pill
        cls="text-blue-700 bg-blue-50 border border-blue-200"
        title="Синхронізую цього пацієнта…"
        clickable={false}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        синхронізую…
      </Pill>
    );
  }

  // Build the visual tone + label as before.
  const ageDays = at
    ? Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)
    : -1;
  let cls = 'text-slate-600';
  let dot = 'bg-slate-400';
  if (!at) {
    cls = 'text-red-700';
    dot = 'bg-red-500';
  } else if (ageDays < 7) {
    cls = 'text-green-700';
    dot = 'bg-green-500';
  } else if (ageDays < 30) {
    cls = 'text-slate-600';
    dot = 'bg-slate-400';
  } else if (ageDays < 90) {
    cls = 'text-orange-700';
    dot = 'bg-orange-500';
  } else {
    cls = 'text-red-700';
    dot = 'bg-red-500';
  }

  const tooltip = at
    ? interactive
      ? `Останній sync: ${formatDateUk(at.slice(0, 10))}\nКлік — синхронізувати зараз`
      : `Останній sync: ${formatDateUk(at.slice(0, 10))}`
    : interactive
      ? 'Жодного разу не синхронізовано\nКлік — синхронізувати зараз'
      : 'Жодного разу не синхронізовано';

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!interactive) return;
    if (sync.blocked) {
      // Another job is in flight (e.g. overnight batch). Don't 409 noisily —
      // just nudge the doctor.
      alert(
        'Інша синхронізація вже виконується. Дочекайтесь її завершення або скасуйте на сторінці «Синхронізація».',
      );
      return;
    }
    if (sync.error) {
      alert(`Не вдалось запустити синхронізацію: ${sync.error}`);
      return;
    }
    sync.start();
  };

  return (
    <Pill cls={cls} title={tooltip} clickable={interactive} onClick={onClick}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {at ? relativeAgo(at) : 'ніколи'}
      {interactive && (
        <RefreshCw className="ml-0.5 h-3 w-3 opacity-0 transition-opacity group-hover/syncpill:opacity-60" />
      )}
    </Pill>
  );
}

function Pill({
  cls,
  title,
  clickable,
  onClick,
  children,
}: {
  cls: string;
  title: string;
  clickable: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const baseCls = 'inline-flex items-center gap-1 text-xs whitespace-nowrap';
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          baseCls,
          'group/syncpill cursor-pointer rounded-md px-1.5 py-0.5 transition hover:bg-slate-100',
          cls,
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={cn(baseCls, cls)} title={title}>
      {children}
    </span>
  );
}
