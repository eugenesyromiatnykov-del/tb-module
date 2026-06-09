import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';

type ActiveSyncJob = {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'stopped' | 'cancelled' | 'done' | 'error';
  scope: 'location' | 'subset' | 'all';
  queue: Array<{ medics_id: string; surname: string | null }>;
  cursor: number;
  current_medics_id: string | null;
};

// Blocking full-screen overlay shown while a batch sync is active. Stops the
// doctor from navigating into stale data while МІС tabs are open and the
// extension is mid-cycle. /sync itself stays unblocked — that page is the
// primary control surface for sync state, with its own resume/cancel UI.
//
// Click "Призупинити" → POST stop. The extension polls every 4 s, sees
// status='stopped', stands down at the end of the current patient cycle
// (its existing `status !== 'running' && status !== 'queued'` guard), and
// the SW closes the medics.ua/doctors/journal tabs. Once the GET returns
// status terminal (no active job), the overlay routes the doctor back
// to /sync where they can resume or cancel.
//
// Ad-hoc subset-of-1 jobs (the freshness pill on /patients) are
// intentionally EXCLUDED — those are short-lived (~30-90s) and blocking the
// whole UI for one patient would be hostile. The user-visible criterion is
// "this would otherwise block me for hours"; subset-of-1 doesn't qualify.
export function SyncBlockingOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const onSyncPage = location.pathname === '/sync' || location.pathname.startsWith('/sync/');

  const { data } = useQuery({
    queryKey: ['sync-job-active'],
    queryFn: () => apiFetch<{ job: ActiveSyncJob | null }>(`/api/patients?mode=sync_job`),
    refetchInterval: (q) => {
      const j = q.state.data?.job;
      if (j && (j.status === 'queued' || j.status === 'running')) return 2000;
      return 15000;
    },
    refetchOnWindowFocus: true,
  });
  const job = data?.job ?? null;

  const isBatchActive =
    job != null &&
    (job.status === 'queued' || job.status === 'running') &&
    !(job.scope === 'subset' && job.queue.length <= 1);

  // Track whether WE asked for the stop. After the click we want to wait
  // through the brief "status flips to stopped, extension finishes its
  // cycle" window before redirecting, so the user sees a "stopping…"
  // state rather than the overlay snapping closed on them.
  const [pausing, setPausing] = useState(false);
  const pauseMutation = useMutation({
    mutationFn: async (jobId: string) =>
      apiFetch<{ job: ActiveSyncJob }>(`/api/patients?mode=sync_job`, {
        method: 'POST',
        json: { action: 'stop', job_id: jobId },
      }),
    onSuccess: () => {
      setPausing(true);
      qc.invalidateQueries({ queryKey: ['sync-job-active'] });
    },
  });

  // Once the server-side row is no longer in an active state AND we'd
  // already asked for a pause, redirect — but only if we're NOT already
  // on /sync (else the navigate is a no-op).
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!pausing) return;
    if (job && (job.status === 'queued' || job.status === 'running')) return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    setPausing(false);
    if (!onSyncPage) navigate('/sync');
  }, [pausing, job, navigate, onSyncPage]);

  // Reset the redirect lock when a new active job appears so future pauses
  // work (without this, after the first pause the ref stays true forever).
  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running')) {
      redirectedRef.current = false;
    }
  }, [job]);

  const progress = useMemo(() => {
    if (!job) return null;
    const total = job.queue.length;
    if (total === 0) return null;
    return { done: Math.min(job.cursor, total), total };
  }, [job]);

  const currentLabel = useMemo(() => {
    if (!job) return null;
    if (job.current_medics_id) {
      const entry = job.queue.find((q) => q.medics_id === job.current_medics_id);
      if (entry?.surname) return `${entry.surname} (${job.current_medics_id})`;
      return job.current_medics_id;
    }
    return null;
  }, [job]);

  if (onSyncPage) return null;
  if (!isBatchActive && !pausing) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          {pausing ? (
            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          )}
          <h2 className="text-lg font-semibold text-slate-900">
            {pausing ? 'Зупиняємо синхронізацію…' : 'Триває синхронізація'}
          </h2>
        </div>

        <p className="mt-2 text-sm text-slate-600">
          {pausing
            ? 'Дочікуємось завершення поточного пацієнта. Вкладки МІС закриються автоматично.'
            : 'Розширення працює з медкартами в МІС. Інтерфейс реєстру заблоковано щоб дані не зчитувались під час оновлення.'}
        </p>

        {progress && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Прогрес</span>
              <span>{progress.done} / {progress.total}</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {currentLabel && !pausing && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="text-slate-500">Зараз: </span>
            <span className="font-medium">{currentLabel}</span>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            variant="outline"
            disabled={pausing || pauseMutation.isPending || !job}
            onClick={() => job && pauseMutation.mutate(job.id)}
          >
            <Pause className="mr-2 h-4 w-4" />
            {pauseMutation.isPending ? 'Зачекайте…' : 'Призупинити'}
          </Button>
        </div>

        {pauseMutation.error && (
          <p className="mt-3 text-sm text-rose-600">
            Не вдалось зупинити: {(pauseMutation.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
