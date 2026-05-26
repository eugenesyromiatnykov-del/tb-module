import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { FluoroRecord, Patient, SputumTest } from '@/types/database';

export type PatientDetail = {
  patient: Patient;
  fluorography: FluoroRecord[];
  sputum_tests: SputumTest[];
};

export function usePatient(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['patient', id],
    queryFn: () => apiFetch<PatientDetail>(`/api/patients/${id}`),
  });
}

export function useUpdatePatient(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Patient>) =>
      apiFetch<{ patient: Patient }>(`/api/patients/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', id] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Patient>) =>
      apiFetch<{ patient: Patient }>('/api/patients', { method: 'POST', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useAddFluoro(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<FluoroRecord, 'id' | 'created_at' | 'source'>) =>
      apiFetch<{ record: FluoroRecord }>(`/api/records?kind=fluoro`, { method: 'POST', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useDeleteFluoro(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/records?kind=fluoro&id=${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useAddSputum(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SputumTest, 'id' | 'created_at'>) =>
      apiFetch<{ record: SputumTest }>(`/api/records?kind=sputum`, { method: 'POST', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });
}

export function useDeleteSputum(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/records?kind=sputum&id=${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });
}
