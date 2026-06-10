import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useExtensionDevice } from '@/hooks/useExtensionDevice';

type ActiveJob = {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'stopped' | 'cancelled' | 'done' | 'error';
  scope: 'location' | 'subset' | 'all';
  queue: Array<{ medics_id: string }>;
  failed: Array<{ medics_id: string | null; surname: string | null; reason: string }>;
  current_medics_id: string | null;
};

// Polls /api/patients?mode=sync_job globally (deduped by react-query key so
// every SyncCell on the page shares the single underlying request). When a
// job is active we poll fast (2 s) so the "Синхронізую…" pill flips to
// "done" promptly; when idle we back off (15 s) to avoid hammering the
// endpoint on a /patients page that has nothing happening.
function useActiveSyncJob() {
  return useQuery({
    queryKey: ['sync-job-active'],
    queryFn: () => apiFetch<{ job: ActiveJob | null }>(`/api/patients?mode=sync_job`),
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      if (job && (job.status === 'queued' || job.status === 'running')) return 2000;
      return 15000;
    },
    refetchOnWindowFocus: true,
  });
}

// Triggers a 1-patient sync via the existing subset scope and reports a
// minimal status state for the calling SyncCell:
//   • busy=true while THIS patient is the head of an active subset-of-1 job
//   • blocked=true while ANOTHER job (overnight batch / different patient)
//     is in flight — the click would 409 anyway
// On job completion, patient + dashboard caches are invalidated so the
// freshness pill self-updates with the new diagnoses_synced_at.
export function useSinglePatientSync(medicsId: string | null | undefined) {
  const qc = useQueryClient();
  const activeJobQuery = useActiveSyncJob();
  const job = activeJobQuery.data?.job ?? null;

  const isOurAdHocJob = useMemo(() => {
    if (!job || !medicsId) return false;
    if (job.scope !== 'subset') return false;
    if (job.queue.length !== 1) return false;
    return job.queue[0]?.medics_id === medicsId;
  }, [job, medicsId]);

  const busy =
    isOurAdHocJob && (job?.status === 'queued' || job?.status === 'running');

  // Legacy: was used to block clicks while another job ran. Kept as a
  // hint for callers that might want to visually highlight "your big
  // sync will pause"; the server auto-pauses regardless.
  const blocked =
    !isOurAdHocJob && job != null && (job.status === 'queued' || job.status === 'running');

  // When the ad-hoc job we kicked off finishes, refresh the patient row(s).
  // Tracking previous status here keeps us from over-invalidating on every
  // poll tick.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      qc.invalidateQueries({ queryKey: ['indicators-rows'] });
      qc.invalidateQueries({ queryKey: ['indicators-summary'] });
    }
    wasBusy.current = busy;
  }, [busy, qc]);

  // Snapshot any failure for THIS patient that lands in job.failed[]
  // before the job moves to terminal status (after which GET returns null
  // and we lose visibility). The error is shown on the pill for 6 s and
  // auto-cleared so a re-attempt starts clean.
  const [lastError, setLastError] = useState<string | null>(null);
  useEffect(() => {
    if (!medicsId || !isOurAdHocJob || !job) return;
    const failedEntry = job.failed?.find(
      (f) => String(f.medics_id) === String(medicsId),
    );
    if (failedEntry?.reason) setLastError(failedEntry.reason);
  }, [job, medicsId, isOurAdHocJob]);
  useEffect(() => {
    if (!lastError) return;
    const t = setTimeout(() => setLastError(null), 6000);
    return () => clearTimeout(t);
  }, [lastError]);

  const device = useExtensionDevice();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!medicsId) throw new Error('medics_id required');
      return apiFetch<{ job: ActiveJob }>(`/api/patients?mode=sync_job`, {
        method: 'POST',
        json: {
          action: 'start',
          scope: 'subset',
          medics_id_list: [medicsId],
          device_id: device.id,
          device_label: device.label,
        },
      });
    },
    onMutate: () => {
      setLastError(null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-job-active'] });
      // Wake the extension SW immediately. Without this, the SW only
      // notices the new job at its next chrome.alarms tick (≤30 s),
      // which is the 5–45 s "тупорыла задержка" the doctor reported.
      // The bridge content script on tb-module.vercel.app picks this up
      // and forwards to the SW as a tb-sync-check message.
      try {
        window.dispatchEvent(new CustomEvent('tb-sync-poke'));
      } catch (_) { /* SSR / no-window */ }
    },
  });

  return {
    start: () => mutation.mutate(),
    isPending: mutation.isPending,
    busy,
    blocked,
    error: mutation.error?.message ?? null,
    lastError,
    dismissLastError: () => setLastError(null),
  };
}
