import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type DashboardStats = {
  overdue: number;
  this_week: number;
  next_30: number;
  no_fluoro: number;
  contacts_no_fluoro: number;
  detected: number;
  totalActive: number;
  lastImport_daysAgo: number; // -1 if never
};

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const r = await apiFetch<{ stats: DashboardStats }>('/api/patients?mode=stats');
      return r.stats;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
