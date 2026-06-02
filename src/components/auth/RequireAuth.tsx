import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { checkAuth, type AuthState } from '@/lib/auth';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<AuthState>('unknown');

  useEffect(() => {
    let cancelled = false;
    checkAuth().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mount once whenever the session is confirmed — fetches the Supabase JWT
  // and subscribes to postgres_changes for the watched tables.
  useRealtimeSync(state === 'authed');

  if (state === 'unknown') {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Завантаження…
      </div>
    );
  }
  if (state === 'guest') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
