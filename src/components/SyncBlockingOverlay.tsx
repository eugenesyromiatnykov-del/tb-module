import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { SyncJobDetails, type SyncJobLike } from '@/components/SyncJobDetails';
import { useDoctor } from '@/hooks/useDoctor';

// Blocking full-screen overlay shown while a multi-patient sync is active.
// Stops the doctor from navigating the registry while МІС tabs are still
// open and the extension is mid-cycle — reads would be stale until the
// patient currently being processed finishes and writes back.
//
// Visibility rules:
//   • status must be running or queued (terminal states release the lock)
//   • /sync route is exempt — that page is the primary control surface
//     with its own resume/cancel buttons; double-blocking it is hostile
//   • ad-hoc single-patient runs from the freshness pill skip the overlay
//     because they finish in 30-90s and SyncCell already shows a spinner;
//     a full-screen block for one patient is overkill. We identify those
//     by `scope='subset' && medics_id_list.length === 1` — checking
//     medics_id_list rather than queue.length because queue gets filtered
//     server-side (archived rows dropped) and may end up empty for an
//     ad-hoc, breaking a naïve queue-based heuristic.
//
// Click «Призупинити» → POST {action:'stop'}. The extension's poll loop
// notices the state flip, finishes the cycle for the patient it was
// driving, signals the SW to close every /doctors/journal tab, and lands
// at idle. Overlay tracks this transition and redirects the doctor to
// /sync once the active state clears.
export function SyncBlockingOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const onSyncPage = location.pathname === '/sync' || location.pathname.startsWith('/sync/');

  // Skip polling entirely for doctors who can't launch sync (server short-
  // circuits the same way via sync_disabled, but disabling the query here
  // also avoids the network round-trip + auth bcrypt on every interval).
  const { data: doctor } = useDoctor();
  const canRunSync = doctor?.can_run_sync ?? true;

  const { data } = useQuery({
    queryKey: ['sync-job-active'],
    queryFn: () => apiFetch<{ job: SyncJobLike | null }>(`/api/patients?mode=sync_job`),
    enabled: canRunSync,
    // Idle: 5 min (Realtime is the primary signal; this is a backstop).
    // Active: 2 s (the overlay drives the "is the sync finished?" redirect,
    // a longer interval would feel sluggish to the doctor).
    refetchInterval: (q) => {
      const j = q.state.data?.job;
      if (j && (j.status === 'queued' || j.status === 'running')) return 2000;
      return 5 * 60_000;
    },
    refetchOnWindowFocus: false,
  });
  const job = data?.job ?? null;

  const isAdHoc =
    job != null && job.scope === 'subset' && (job.medics_id_list?.length ?? 0) === 1;
  const isBatchActive =
    job != null && (job.status === 'queued' || job.status === 'running') && !isAdHoc;

  const [pausing, setPausing] = useState(false);
  const pauseMutation = useMutation({
    mutationFn: async (jobId: string) =>
      apiFetch<{ job: SyncJobLike }>(`/api/patients?mode=sync_job`, {
        method: 'POST',
        json: { action: 'stop', job_id: jobId },
      }),
    onSuccess: () => {
      setPausing(true);
      qc.invalidateQueries({ queryKey: ['sync-job-active'] });
    },
  });

  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!pausing) return;
    if (job && (job.status === 'queued' || job.status === 'running')) return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    setPausing(false);
    if (!onSyncPage) navigate('/sync');
  }, [pausing, job, navigate, onSyncPage]);

  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running')) {
      redirectedRef.current = false;
    }
  }, [job]);

  if (onSyncPage) return null;
  if (!isBatchActive && !pausing) return null;
  if (!job) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Loader2
            className={`h-6 w-6 animate-spin ${pausing ? 'text-amber-600' : 'text-blue-600'}`}
          />
          <h2 className="text-lg font-semibold text-slate-900">
            {pausing ? 'Зупиняємо синхронізацію…' : 'Триває синхронізація'}
          </h2>
        </div>

        <p className="mt-2 text-sm text-slate-600">
          {pausing
            ? 'Дочікуємось завершення поточного пацієнта. Вкладки МІС закриються автоматично.'
            : 'Розширення працює з медкартами в МІС. Інтерфейс реєстру заблоковано щоб дані не зчитувались під час оновлення.'}
        </p>

        <div className="mt-4">
          <SyncJobDetails job={job} />
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            variant="outline"
            disabled={pausing || pauseMutation.isPending}
            onClick={() => pauseMutation.mutate(job.id)}
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
