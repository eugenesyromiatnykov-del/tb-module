import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type Doctor = { id: string; name: string };

// Fetch the logged-in doctor from /api/auth/me. Surfaces id + name so
// the Sidebar can show "Лікар: Doctor 1" and so future per-doctor UI
// (e.g. account settings) has the id to work with.
//
// Cached for 5 minutes — doctor identity doesn't change during a session.
// Stays stale-fresh on tab focus so a forced re-login (clear cookie)
// flips the state quickly.
export function useDoctor() {
  return useQuery({
    queryKey: ['auth-doctor'],
    queryFn: async () => {
      const r = await apiFetch<{ ok: boolean; doctor: Doctor | null }>(`/api/auth/me`);
      return r.doctor;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
