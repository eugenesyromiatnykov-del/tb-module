import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { relativeAgo } from '@/lib/date-utils';

type SyncMeta = {
  most_recent_synced_at: string | null;
  total: number;
  synced: number;
};

function useSyncMeta() {
  return useQuery({
    queryKey: ['sync-meta'],
    queryFn: () => apiFetch<SyncMeta>('/api/patients?mode=sync_meta'),
    staleTime: 60_000,
  });
}

// Slim caption shown under page headers on the registry tables. Tells the
// doctor when any patient was last synced via the extension, plus what
// fraction of the registry has been touched at all. Click → /sync.
export function SyncFreshness() {
  const { data } = useSyncMeta();
  if (!data) return null;
  const pct = data.total > 0 ? Math.round((data.synced / data.total) * 100) : 0;
  return (
    <div className="text-xs text-slate-500">
      Останній sync: <span className="font-medium text-slate-700">{relativeAgo(data.most_recent_synced_at)}</span>
      <span className="mx-2 text-slate-300">·</span>
      <span>{data.synced}/{data.total} пацієнтів синхронізовано ({pct}%)</span>
      <Link to="/sync" className="ml-2 text-blue-600 hover:underline">
        синхронізувати →
      </Link>
    </div>
  );
}
