import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, setSupabaseAuth } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';

// Tables we want to push to the UI in (near-)real time. Anything not in this
// list still gets the regular refetch-on-focus refresh.
const WATCHED_TABLES = [
  'patients',
  'fluorography',
  'sputum_tests',
  'quantiferon_tests',
  'adpm_vaccinations',
] as const;

// Once the user's PIN cookie is set, the server can mint a Supabase-compatible
// JWT bound to `role: authenticated`. We fetch it, hand it to the supabase
// client, then subscribe to the relevant postgres_changes channels and
// invalidate react-query keys whenever something changes — so list pages,
// dashboards and patient cards rerender without manual refresh.
//
// One subscription is enough for the whole app — invalidation is cheap and
// react-query will only refetch queries that are mounted. Designed to be
// mounted once at the App level.
export function useRealtimeSync(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchToken(): Promise<number | null> {
      try {
        const r = await apiFetch<{ supabase?: { token: string; expires_in: number } | null }>(
          '/api/auth/me?supabase=1',
        );
        if (cancelled) return null;
        const t = r.supabase?.token;
        if (!t) {
          console.warn('[realtime] no supabase token from /api/auth/me — check SUPABASE_JWT_SECRET');
          return null;
        }
        setSupabaseAuth(t);
        return r.supabase?.expires_in ?? 3600;
      } catch (e) {
        console.warn('[realtime] failed to fetch supabase token', e);
        return null;
      }
    }

    const channels: ReturnType<typeof supabase.channel>[] = [];

    function onAnyChange(table: string) {
      return () => {
        if (table === 'patients') {
          qc.invalidateQueries({ queryKey: ['patients'] });
          qc.invalidateQueries({ queryKey: ['patient'] });
          qc.invalidateQueries({ queryKey: ['patients-villages'] });
        } else {
          qc.invalidateQueries({ queryKey: ['patient'] });
          qc.invalidateQueries({ queryKey: ['patients'] });
          qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
        }
      };
    }

    function subscribe() {
      for (const table of WATCHED_TABLES) {
        const ch = supabase
          .channel(`rt:${table}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, onAnyChange(table))
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn(`[realtime] channel ${table} ${status}`);
            }
          });
        channels.push(ch);
      }
    }

    (async () => {
      const ttl = await fetchToken();
      if (cancelled) return;
      subscribe();
      // Refresh token before it expires — Supabase Realtime drops the channel
      // if the JWT goes stale. Refresh at 80% of TTL.
      if (ttl) {
        const refreshIn = Math.max(60_000, ttl * 800);
        refreshTimer = setTimeout(async function refresh() {
          const next = await fetchToken();
          if (cancelled || !next) return;
          refreshTimer = setTimeout(refresh, Math.max(60_000, next * 800));
        }, refreshIn);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const ch of channels) supabase.removeChannel(ch);
    };
  }, [enabled, qc]);
}
