import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // We don't crash so the app shell still renders during early Phase 0,
  // but every data hook should `throw` if it tries to use the client.
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Add them to .env.local before running data-bound features.',
  );
}

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'public-anon-key', {
  auth: { persistSession: false },
});

// Pass the JWT minted server-side (api/auth/me?supabase=1) so the Realtime
// gateway treats this connection as `role: authenticated` and RLS policies
// for that role apply. Calling with null clears auth (anonymous).
export function setSupabaseAuth(token: string | null): void {
  // Token used for REST + Realtime auth headers.
  // realtime.setAuth keeps the websocket sub channel updated mid-flight.
  supabase.realtime.setAuth(token ?? '');
  // @ts-expect-error — public API in v2 but not in our installed type defs
  if (typeof supabase.auth.setAuth === 'function') supabase.auth.setAuth(token);
}
