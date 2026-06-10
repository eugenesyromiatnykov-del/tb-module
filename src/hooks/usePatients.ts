import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { Patient, PatientForDiff } from '@/types/database';

export type PatientFilter =
  | 'overdue'
  | 'this_week'
  | 'next_30'
  | 'no_fluoro'
  | 'contacts_no_fluoro'
  | 'detected';

export type AdpmFilter =
  | 'vaccinated'
  | 'contraindicated'
  | 'refused'
  | 'pending'
  | 'this_year'
  | 'overdue';

// Disjoint bins that match the SyncCell color bands (green/slate/orange/red).
// OR-combined when multi-selected.
export type SyncFreshFilter =
  | 'never'   // diagnoses_synced_at IS NULL
  | 'gt90'    // > 90 днів тому
  | '30to90'  // 30–90 днів тому
  | '7to30'   // 7–30 днів тому
  | 'lt7';    // < 7 днів тому

export const SYNC_FILTER_LABELS: Record<SyncFreshFilter, string> = {
  never: 'Ніколи',
  gt90: 'Понад 90 днів',
  '30to90': 'Від 30 до 90 днів',
  '7to30': 'Від 7 до 30 днів',
  lt7: 'Менше 7 днів',
};

// Fluoro snapshot status bins. OR-combined when multi-selected — the
// ranges intentionally overlap (under_6m includes under_3m) so the
// doctor can pick "everyone whose next is within half a year" as one
// bucket without having to also tick the 3-month one.
export type FluoroStatusFilter =
  | 'missing'   // last_fluoro_date IS NULL
  | 'overdue'   // next_planned_date IS NOT NULL AND next_planned_date < today
  | 'under_3m'  // today <= next_planned_date < today + ~90 days
  | 'under_6m'; // today <= next_planned_date < today + ~180 days

export const FLUORO_STATUS_LABELS: Record<FluoroStatusFilter, string> = {
  missing: 'Нема знімка',
  overdue: 'Прострочено',
  under_3m: 'Менш як 3 міс. до планового',
  under_6m: 'Менш як 6 міс. до планового',
};

export type PatientFilters = {
  location?: string;
  status?: string;
  group?: string;       // single risk-group key (medical or social)
  external?: '1' | '0'; // '1' = only external, '0' = only declarants
  search?: string;
  archived?: boolean;
  filter?: PatientFilter;
  adpm?: AdpmFilter[];  // OR-combined statuses
  sync?: SyncFreshFilter[]; // OR-combined freshness bins
  fluoroStatus?: FluoroStatusFilter[]; // OR-combined fluoro status bins
  address?: string;     // ILIKE on address (street/house substring)
  villages?: string[];  // exact match on derived `village` column
  cleared?: 'include' | 'only'; // default: exclude tb_status='cleared'
};

export const FILTER_LABELS: Record<PatientFilter, string> = {
  overdue: 'Прострочено',
  this_week: 'На цьому тижні',
  next_30: 'Найближчі 30 днів',
  no_fluoro: 'Без флюоро',
  contacts_no_fluoro: 'Контактні без флюоро',
  detected: 'Виявлені',
};

function buildQuery(filters: PatientFilters): string {
  const params = new URLSearchParams();
  if (filters.location) params.set('location', filters.location);
  if (filters.status) params.set('status', filters.status);
  if (filters.group) params.set('group', filters.group);
  if (filters.external) params.set('external', filters.external);
  if (filters.search) params.set('search', filters.search);
  if (filters.archived) params.set('archived', '1');
  if (filters.filter) params.set('filter', filters.filter);
  if (filters.adpm && filters.adpm.length > 0) {
    params.set('adpm', filters.adpm.join(','));
  }
  if (filters.sync && filters.sync.length > 0) {
    params.set('sync', filters.sync.join(','));
  }
  if (filters.fluoroStatus && filters.fluoroStatus.length > 0) {
    params.set('fluoro_status', filters.fluoroStatus.join(','));
  }
  if (filters.address) params.set('address', filters.address);
  if (filters.villages && filters.villages.length > 0) {
    params.set('village', filters.villages.join(','));
  }
  if (filters.cleared) params.set('cleared', filters.cleared);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function usePatients(filters: PatientFilters) {
  return useQuery({
    queryKey: ['patients', filters],
    queryFn: () =>
      apiFetch<{ patients: Patient[] }>(`/api/patients${buildQuery(filters)}`),
    placeholderData: (prev) => prev,
  });
}

export function fetchPatientsForDiff() {
  return apiFetch<{ patients: PatientForDiff[] }>(`/api/patients?mode=diff`);
}

export type ReportRow = Patient & {
  fluoro: Array<{ date: string; result: string | null; result_code: string }>;
  xpert: { date: string; result: string | null } | null;
  quantiferon: { date: string; result_code: string } | null;
  questionnaire: { filled_at: string; result: string } | null;
};

export function fetchReportRows(filters: PatientFilters): Promise<{ rows: ReportRow[] }> {
  const qs = buildQuery(filters);
  const sep = qs ? '&' : '?';
  return apiFetch<{ rows: ReportRow[] }>(`/api/patients${qs}${sep}mode=report`);
}

export function useVillages() {
  return useQuery({
    queryKey: ['patients-villages'],
    queryFn: () => apiFetch<{ villages: string[] }>(`/api/patients?mode=villages`),
    staleTime: 60_000 * 5,
  });
}
