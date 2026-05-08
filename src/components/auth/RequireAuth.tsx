import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { checkAuth, type AuthState } from '@/lib/auth';

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
