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

export type PatientFilters = {
  location?: string;
  status?: string;
  search?: string;
  archived?: boolean;
  filter?: PatientFilter;
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
  if (filters.search) params.set('search', filters.search);
  if (filters.archived) params.set('archived', '1');
  if (filters.filter) params.set('filter', filters.filter);
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
