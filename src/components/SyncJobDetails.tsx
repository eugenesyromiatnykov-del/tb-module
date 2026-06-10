import { LOCATION_LABELS, type LocationId } from '@/types/database';

export type SyncJobLike = {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'stopped' | 'cancelled' | 'done' | 'error';
  scope: 'location' | 'subset' | 'all';
  location: string | null;
  only_unsynced: boolean;
  medics_id_list: string[] | null;
  queue: Array<{ medics_id: string; surname?: string | null }>;
  cursor: number;
  failed: Array<{ medics_id: string | null; surname: string | null; reason: string }>;
  current_medics_id: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
};

const STATUS_LABELS: Record<SyncJobLike['status'], { label: string; tone: string }> = {
  queued:    { label: 'У черзі',    tone: 'bg-slate-100 text-slate-700' },
  running:   { label: 'Працює',     tone: 'bg-blue-100 text-blue-700' },
  paused:    { label: 'Призупинено', tone: 'bg-amber-100 text-amber-700' },
  stopped:   { label: 'Зупинено',   tone: 'bg-amber-100 text-amber-700' },
  cancelled: { label: 'Скасовано',  tone: 'bg-slate-100 text-slate-600' },
  done:      { label: 'Завершено',  tone: 'bg-emerald-100 text-emerald-700' },
  error:     { label: 'Помилка',    tone: 'bg-rose-100 text-rose-700' },
};

// Compact "what is this sync, how is it going" panel rendered in two
// places: the blocking overlay (visible on every route when batch is
// running) and the /sync page (resume controls). Shows the run shape
// (scope + location + filter hints), the live progress (cursor / total /
// errors), and the current patient if any.
//
// Note: subset jobs were started from /patients with a list of medics_ids
// derived from filter UI state — those underlying filters are NOT
// persisted on sync_jobs today, so for subset runs we show the patient
// count instead. If the doctor wants exact filter recall, we'll add a
// `filter_snapshot jsonb` column to sync_jobs in a follow-up.
export function SyncJobDetails({ job }: { job: SyncJobLike }) {
  const total = job.queue.length;
  const done = Math.min(job.cursor, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const failedCount = job.failed?.length ?? 0;
  const statusInfo = STATUS_LABELS[job.status];

  const scopeChips: Array<{ key: string; label: string }> = [];
  if (job.scope === 'location') {
    scopeChips.push({ key: 'scope', label: 'По амбулаторії' });
    if (job.location) {
      scopeChips.push({
        key: 'location',
        label: LOCATION_LABELS[job.location as LocationId] ?? job.location,
      });
    }
  } else if (job.scope === 'subset') {
    const ids = job.medics_id_list?.length ?? total;
    scopeChips.push({
      key: 'scope',
      label: ids === 1 ? 'Один пацієнт' : `Вибірка з ${ids}`,
    });
  } else if (job.scope === 'all') {
    scopeChips.push({ key: 'scope', label: 'Усі пацієнти' });
  }
  if (job.scope !== 'subset') {
    scopeChips.push({
      key: 'onlyUnsynced',
      label: job.only_unsynced ? 'Тільки несинхронізовані' : 'Усі (з повторними)',
    });
  }

  const currentSurname = job.current_medics_id
    ? job.queue.find((q) => q.medics_id === job.current_medics_id)?.surname ?? null
    : null;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.tone}`}
        >
          {statusInfo.label}
        </span>
        {scopeChips.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
          >
            {c.label}
          </span>
        ))}
      </div>

      {total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Прогрес</span>
            <span>
              {done} / {total} ({pct}%)
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {job.current_medics_id && (job.status === 'running' || job.status === 'queued') && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Зараз: </span>
          <span className="font-medium text-slate-800">
            {currentSurname ? `${currentSurname} (${job.current_medics_id})` : job.current_medics_id}
          </span>
        </div>
      )}

      {failedCount > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <span className="font-medium">Помилок: {failedCount}</span>
          <span className="ml-1 text-rose-600">— деталі на /sync</span>
        </div>
      )}
    </div>
  );
}
