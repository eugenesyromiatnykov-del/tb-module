import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { Patient, PatientForDiff } from '@/types/database';

export type PatientFilters = {
  location?: string;
  status?: string;
  search?: string;
  archived?: boolean;
};

function buildQuery(filters: PatientFilters): string {
  const params = new URLSearchParams();
  if (filters.location) params.set('location', filters.location);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.archived) params.set('archived', '1');
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
