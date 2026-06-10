import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause, Play, Square, Trash2 } from 'lucide-react';
import { useExtensionDevice } from '@/hooks/useExtensionDevice';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { apiFetch } from '@/lib/api';
import { formatDateUk } from '@/lib/date-utils';
import { LOCATION_LABELS, type LocationId } from '@/types/database';
import { cn } from '@/lib/utils';

type JobScope = 'location' | 'subset' | 'all';
type JobStatus = 'queued' | 'running' | 'paused' | 'stopped' | 'cancelled' | 'done' | 'error';

export type SyncJob = {
  id: string;
  location: LocationId | null;
  only_unsynced: boolean;
  scope: JobScope;
  medics_id_list: string[] | null;
  queue: Array<{ medics_id: string; surname: string | null; location_id: string | null }>;
  cursor: number;
  failed: Array<{ medics_id: string | null; surname: string | null; reason: string }>;
  current_medics_id: string | null;
  status: JobStatus;
  started_at: string | null;
  last_heartbeat_at: string | null;
  stopped_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  owner_device_id: string | null;
  owner_device_label: string | null;
};

function useActiveSyncJob() {
  return useQuery({
    queryKey: ['sync-job-active'],
    queryFn: () =>
      apiFetch<{ job: SyncJob | null; paused: SyncJob[] }>(
        `/api/patients?mode=sync_job`,
      ),
    refetchInterval: 3000, // belt-and-suspenders alongside Realtime
  });
}

type DeviceInfo = { device_id: string | null; device_label: string | null };

async function startJob(input: { location: LocationId; only_unsynced: boolean } & DeviceInfo) {
  return apiFetch<{ job: SyncJob }>(`/api/patients?mode=sync_job`, {
    method: 'POST',
    json: { action: 'start', scope: 'location', ...input },
  });
}
async function stopJob(jobId: string) {
  return apiFetch<{ job: SyncJob }>(`/api/patients?mode=sync_job`, {
    method: 'POST',
    json: { action: 'stop', job_id: jobId },
  });
}
async function resumeJob(jobId: string, device: DeviceInfo) {
  return apiFetch<{ job: SyncJob; reset: boolean }>(`/api/patients?mode=sync_job`, {
    method: 'POST',
    json: { action: 'resume', job_id: jobId, ...device },
  });
}
async function cancelJob(jobId: string) {
  return apiFetch<{ job: SyncJob }>(`/api/patients?mode=sync_job`, {
    method: 'POST',
    json: { action: 'cancel', job_id: jobId },
  });
}

export function SyncPage() {
  const { data, isLoading } = useActiveSyncJob();
  const job = data?.job ?? null;
  const pausedJobs = data?.paused ?? [];
  const qc = useQueryClient();

  const [location, setLocation] = useState<LocationId>('bilohirska');
  const [onlyUnsynced, setOnlyUnsynced] = useState(true);
  const [busy, setBusy] = useState(false);

  const refreshNow = () => qc.invalidateQueries({ queryKey: ['sync-job-active'] });
  // Bridge → SW. The tb-module-bridge.js content script forwards this
  // to chrome.runtime.sendMessage({type:'tb-sync-check'}), so the SW
  // opens /journal immediately instead of waiting for its next 30 s
  // alarm tick.
  const pokeSw = () => {
    try { window.dispatchEvent(new CustomEvent('tb-sync-poke')); } catch (_) {}
  };

  const device = useExtensionDevice();
  const onStart = async () => {
    setBusy(true);
    try {
      await startJob({
        location,
        only_unsynced: onlyUnsynced,
        device_id: device.id,
        device_label: device.label,
      });
      refreshNow();
      pokeSw();
    } catch (e) {
      alert(`Не вдалось запустити: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const onStop = async () => {
    if (!job) return;
    if (!confirm('Зупинити синхронізацію?')) return;
    setBusy(true);
    try {
      await stopJob(job.id);
      refreshNow();
    } finally { setBusy(false); }
  };
  const onResume = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const r = await resumeJob(job.id, { device_id: device.id, device_label: device.label });
      if (r.reset) {
        alert('Минуло більше 24 годин — черга побудована з нуля.');
      }
      pokeSw();
      refreshNow();
    } finally { setBusy(false); }
  };
  const onCancel = async () => {
    if (!job) return;
    if (!confirm('Повністю скасувати завдання? Прогрес зникне, поточну чергу не вдасться продовжити.')) return;
    setBusy(true);
    try {
      await cancelJob(job.id);
      refreshNow();
    } finally { setBusy(false); }
  };

  // Acting on a specific paused job (when there are multiple). The
  // active job (if any) is auto-paused on the server side when this
  // resume hits — so the doctor never has to think about "but my big
  // sync is running".
  const onResumePaused = async (id: string) => {
    setBusy(true);
    try {
      const r = await resumeJob(id, { device_id: device.id, device_label: device.label });
      if (r.reset) alert('Минуло більше 24 годин — черга побудована з нуля.');
      pokeSw();
      refreshNow();
    } catch (e) {
      alert(`Не вдалось продовжити: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };
  const onCancelPaused = async (id: string) => {
    if (!confirm('Скасувати цей збережений запуск? Відновити не можна буде.')) return;
    setBusy(true);
    try {
      await cancelJob(id);
      refreshNow();
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        title="Синхронізація"
        subtitle="Автоматичний обхід усіх декларантів через МІС, з прогресом у реальному часі"
      />

      {/* Device-binding indicator — surfaces whether the bridge handshake
          completed. Null state means subsequent {action:'start'} sends
          device_id=null and falls back to first-to-poll race; the doctor
          should reload the extension / refresh the page before clicking. */}
      <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
        <span className={cn(
          'h-2 w-2 rounded-full',
          device.id ? 'bg-emerald-500' : 'bg-amber-500',
        )} />
        {device.id ? (
          <span className="text-slate-700">
            Цей пристрій: <span className="font-medium">{device.label || 'Browser'}</span>
            <span className="ml-1 text-slate-400">·{device.id.slice(0, 6)}</span>
          </span>
        ) : (
          <span className="text-amber-700">
            Розширення не відповіло. Перезавантаж сторінку або chrome://extensions → Reload.
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : !job ? (
        <StartCard
          location={location}
          setLocation={setLocation}
          onlyUnsynced={onlyUnsynced}
          setOnlyUnsynced={setOnlyUnsynced}
          busy={busy}
          onStart={onStart}
        />
      ) : (
        <ActiveJobCard job={job} busy={busy} onStop={onStop} onResume={onResume} onCancel={onCancel} />
      )}

      {pausedJobs.length > 0 && (
        <PausedJobsList
          jobs={pausedJobs}
          busy={busy}
          onResume={onResumePaused}
          onCancel={onCancelPaused}
          activeJobId={job?.id ?? null}
        />
      )}

      {/* Show the "start new" form below the active card, so the doctor
          can launch a quick subset run while the big one is mid-flight.
          Server auto-pauses the running job — see action=start in api. */}
      {job && (
        <details className="mt-4 rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            + Запустити паралельну синхронізацію (поточну поставимо на паузу)
          </summary>
          <div className="border-t border-slate-200 p-4">
            <StartCard
              location={location}
              setLocation={setLocation}
              onlyUnsynced={onlyUnsynced}
              setOnlyUnsynced={setOnlyUnsynced}
              busy={busy}
              onStart={onStart}
              dense
            />
          </div>
        </details>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Як це працює</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p>
            <b>1.</b> Виберіть амбулаторію й натисніть «Запустити». Розширення автоматично відкриє фонову вкладку <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">medics.ua/doctors/journal</code> — нічого окремо запускати не треба.
          </p>
          <p>
            <b>2.</b> На стороні MIS розширення опитує наш бекенд раз на 4 секунди, бачить активне завдання й послідовно обходить пацієнтів. Перший пацієнт стартує впродовж 30 секунд після кліку «Запустити».
          </p>
          <p>
            <b>3.</b> Можна закрити цю вкладку — прогрес зберігається в БД. Можна зупинити в будь-який момент і продовжити пізніше. Якщо перерва більше <b>24 годин</b>, черга збирається з нуля (бо стан пацієнтів за добу міг змінитись).
          </p>
          <p>
            <b>4.</b> Поки виконується — <b>не клікайте по фоновій вкладці MIS</b>, інакше зіб'ється DOM-послідовність. Інші вкладки Chrome можна використовувати без обмежень.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function StartCard({
  location, setLocation, onlyUnsynced, setOnlyUnsynced, busy, onStart, dense = false,
}: {
  location: LocationId;
  setLocation: (l: LocationId) => void;
  onlyUnsynced: boolean;
  setOnlyUnsynced: (v: boolean) => void;
  busy: boolean;
  onStart: () => void;
  dense?: boolean;
}) {
  const body = (
    <div className={dense ? 'space-y-3' : 'space-y-4'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Амбулаторія</label>
          <Select value={location} onChange={(e) => setLocation(e.target.value as LocationId)}>
            {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
              <option key={id} value={id}>{LOCATION_LABELS[id]}</option>
            ))}
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={onlyUnsynced}
            onChange={(e) => setOnlyUnsynced(e.target.checked)}
          />
          Тільки нові (без diagnoses_synced_at)
        </label>
      </div>
      <Button onClick={onStart} disabled={busy}>
        <Play className="h-4 w-4" />
        {busy ? 'Запускаємо…' : 'Запустити синхронізацію'}
      </Button>
    </div>
  );
  if (dense) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Новий запуск</CardTitle>
      </CardHeader>
      <CardBody>{body}</CardBody>
    </Card>
  );
}

function PausedJobsList({
  jobs, busy, onResume, onCancel,
}: {
  jobs: SyncJob[];
  busy: boolean;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  activeJobId: string | null;
}) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>На паузі</span>
          <span className="text-xs font-normal text-slate-500">{jobs.length}</span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        {jobs.map((j) => {
          const total = j.queue.length;
          const done = j.cursor;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const label =
            j.scope === 'subset'
              ? `Підмножина · ${total} пацієнтів`
              : j.location
                ? LOCATION_LABELS[j.location as LocationId]
                : 'Усі амбулаторії';
          return (
            <div
              key={j.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800">{label}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <span>{done}/{total} ({pct}%)</span>
                  {j.failed.length > 0 && <span className="text-red-600">· помилок {j.failed.length}</span>}
                  <span>· зупинено {relativeTime(j.stopped_at)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-slate-400" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <Button variant="primary" onClick={() => onResume(j.id)} disabled={busy}>
                <Play className="h-3.5 w-3.5" /> Продовжити
              </Button>
              <Button
                variant="secondary"
                onClick={() => onCancel(j.id)}
                disabled={busy}
                className="!border-red-200 !bg-red-50 !text-red-700 hover:!bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function ActiveJobCard({
  job, busy, onStop, onResume, onCancel,
}: {
  job: SyncJob;
  busy: boolean;
  onStop: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const total = job.queue.length;
  const done = job.cursor;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const eta = useMemo(() => computeEta(job), [job]);
  const stale = useStaleness(job);

  return (
    <Card className={cn(job.status === 'running' && 'border-blue-200', job.status === 'stopped' && 'border-orange-200')}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            Активне завдання · <StatusPill status={job.status} />
          </CardTitle>
          <div className="flex gap-2">
            {(job.status === 'running' || job.status === 'paused' || job.status === 'queued') && (
              <Button variant="secondary" onClick={onStop} disabled={busy}>
                <Square className="h-4 w-4" /> Зупинити
              </Button>
            )}
            {job.status === 'stopped' && (
              <Button onClick={onResume} disabled={busy}>
                <Play className="h-4 w-4" /> Продовжити
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={busy}
              className="!border-red-200 !bg-red-50 !text-red-700 hover:!bg-red-100"
            >
              <Trash2 className="h-4 w-4" /> Скасувати
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <div className="mb-1 flex justify-between text-sm text-slate-600">
            <span>
              {done} / {total} оброблено
              {job.failed.length > 0 && <span className="ml-2 text-red-600">· помилок {job.failed.length}</span>}
            </span>
            <span className="font-mono">{pct}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-200">
            <div
              className={cn(
                'h-full transition-[width] duration-500',
                job.status === 'running' ? 'bg-blue-500' : 'bg-slate-400',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <Row label="Тип запуску">{describeScope(job)}</Row>
          <Row label="Амбулаторія">
            {job.location ? LOCATION_LABELS[job.location as LocationId] : '—'}
          </Row>
          <Row label="Тільки нові">{job.only_unsynced ? 'так' : 'ні'}</Row>
          <Row label="Поточний пацієнт">
            {job.current_medics_id ? (
              <span className="font-mono">{job.current_medics_id}</span>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </Row>
          <Row label="Останнє оновлення">{relativeTime(job.last_heartbeat_at)}</Row>
          <Row label="Запущено">{relativeTime(job.started_at)}</Row>
          {eta && <Row label="Орієнтовно залишилось">{eta}</Row>}
          <Row label="Виконує">
            {job.owner_device_id ? (
              <span className="font-mono text-xs">
                {job.owner_device_label || 'Пристрій'}
                <span className="ml-1 text-slate-400">·{job.owner_device_id.slice(0, 6)}</span>
              </span>
            ) : (
              <span className="text-slate-400">очікує claim</span>
            )}
          </Row>
        </div>

        {stale && (job.status === 'running' || job.status === 'queued') && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
            ⚠ Розширення не б'є heartbeat більше {stale}. Перевір що відкрита вкладка medics.ua з активним розширенням.
          </div>
        )}

        {job.failed.length > 0 && (
          <FailedList failed={job.failed} />
        )}
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900">{children}</span>
    </div>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; cls: string }> = {
    queued:    { label: 'у черзі',     cls: 'bg-slate-100 text-slate-700' },
    running:   { label: 'виконується', cls: 'bg-blue-100 text-blue-800' },
    paused:    { label: 'призупинено', cls: 'bg-amber-100 text-amber-800' },
    stopped:   { label: 'зупинено',    cls: 'bg-orange-100 text-orange-800' },
    cancelled: { label: 'скасовано',   cls: 'bg-red-100 text-red-800' },
    done:      { label: 'завершено',   cls: 'bg-green-100 text-green-800' },
    error:     { label: 'помилка',     cls: 'bg-red-100 text-red-800' },
  };
  const m = map[status];
  return (
    <span className={cn('ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold', m.cls)}>
      {m.label}
    </span>
  );
}

function FailedList({ failed }: { failed: SyncJob['failed'] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer font-medium">
        Помилки ({failed.length}) {open ? '▾' : '▸'}
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {failed.slice(-50).map((f, i) => (
          <li key={i} className="font-mono">
            <span className="text-slate-700">{f.medics_id ?? '—'}</span>
            {f.surname && <span className="ml-2 text-slate-500">{f.surname}</span>}
            <span className="ml-2 text-red-700">: {f.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function computeEta(job: SyncJob): string | null {
  if (job.status !== 'running') return null;
  if (!job.started_at || job.cursor === 0) return null;
  const elapsed = Date.now() - new Date(job.started_at).getTime();
  const perPatient = elapsed / job.cursor;
  const remaining = (job.queue.length - job.cursor) * perPatient;
  return formatDurationMs(remaining);
}

function formatDurationMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} год ${m} хв`;
  if (m > 0) return `${m} хв`;
  return `${s} с`;
}

// One-line "what kind of run is this" summary. For subset jobs the actual
// filter set (villages, fluoro status, etc.) isn't persisted on sync_jobs
// — we only have the resulting medics_id_list — so we show the size, not
// the predicate. Add a `filter_snapshot` column later if recall matters.
function describeScope(job: SyncJob): string {
  if (job.scope === 'all') return 'Усі пацієнти';
  if (job.scope === 'location') {
    return job.location
      ? `По амбулаторії · ${LOCATION_LABELS[job.location as LocationId]}`
      : 'По амбулаторії';
  }
  const n = job.medics_id_list?.length ?? job.queue.length;
  if (n === 1) return 'Один пацієнт (ad-hoc)';
  return `Вибірка · ${n} пацієнтів`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5_000) return 'щойно';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} с тому`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} хв тому`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} год тому`;
  return formatDateUk(iso.slice(0, 10));
}

// Returns a human label when last_heartbeat_at is suspiciously old.
function useStaleness(job: SyncJob): string | null {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  void tick;
  if (!job.last_heartbeat_at) return null;
  const diffMs = Date.now() - new Date(job.last_heartbeat_at).getTime();
  if (diffMs < 60_000) return null;
  if (diffMs < 5 * 60_000) return '> 1 хв';
  return '> 5 хв';
}

void Pause; // reserved for later (pause UI — currently we only stop)
