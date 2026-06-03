import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

type ActiveJob = {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'stopped' | 'cancelled' | 'done' | 'error';
  scope: 'location' | 'subset' | 'all';
  queue: Array<{ medics_id: string }>;
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

  const mutation = useMutation({
    mutationFn: async () => {
      if (!medicsId) throw new Error('medics_id required');
      return apiFetch<{ job: ActiveJob }>(`/api/patients?mode=sync_job`, {
        method: 'POST',
        json: { action: 'start', scope: 'subset', medics_id_list: [medicsId] },
      });
    },
    onSuccess: () => {
      // Force immediate refetch so the SyncCell pill flips into "busy"
      // state without waiting for the next 2 s poll tick.
      qc.invalidateQueries({ queryKey: ['sync-job-active'] });
    },
  });

  return {
    start: () => mutation.mutate(),
    isPending: mutation.isPending,
    busy,
    blocked,
    error: mutation.error?.message ?? null,
  };
}
