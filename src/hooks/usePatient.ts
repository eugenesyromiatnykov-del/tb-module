import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdpmVaccination,
  FluoroRecord,
  Patient,
  QuantiferonTest,
  SputumTest,
} from '@/types/database';

export type PatientDetail = {
  patient: Patient;
  fluorography: FluoroRecord[];
  sputum_tests: SputumTest[];
  quantiferon_tests: QuantiferonTest[];
  adpm_vaccinations: AdpmVaccination[];
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

export function useDeletePatient(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(`/api/patients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patient', id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
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

export function useUpdateFluoro(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<FluoroRecord> }) =>
      apiFetch<{ record: FluoroRecord }>(`/api/records?kind=fluoro&id=${id}`, {
        method: 'PATCH',
        json: patch,
      }),
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

export function useUpdateSputum(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SputumTest> }) =>
      apiFetch<{ record: SputumTest }>(`/api/records?kind=sputum&id=${id}`, {
        method: 'PATCH',
        json: patch,
      }),
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

export function useAddQuantiferon(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<QuantiferonTest, 'id' | 'created_at'>) =>
      apiFetch<{ record: QuantiferonTest }>(`/api/records?kind=quantiferon`, { method: 'POST', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useUpdateQuantiferon(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<QuantiferonTest> }) =>
      apiFetch<{ record: QuantiferonTest }>(`/api/records?kind=quantiferon&id=${id}`, {
        method: 'PATCH',
        json: patch,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useDeleteQuantiferon(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/records?kind=quantiferon&id=${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

// ─── АДП-М ─────────────────────────────────────────────────────────────────
export function useAddAdpm(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AdpmVaccination, 'id' | 'created_at' | 'source'>) =>
      apiFetch<{ record: AdpmVaccination }>(`/api/records?kind=adpm`, { method: 'POST', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useUpdateAdpm(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AdpmVaccination> }) =>
      apiFetch<{ record: AdpmVaccination }>(`/api/records?kind=adpm&id=${id}`, {
        method: 'PATCH',
        json: patch,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useDeleteAdpm(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/records?kind=adpm&id=${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

// Requests a signed upload URL, uploads the file, then PATCHes the patient
// with the resulting storage path.
export function useUploadAdpmRefusalPhoto(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const sig = await apiFetch<{ path: string; upload_url: string; token: string }>(
        `/api/patients/${patientId}?action=adpm_refusal_upload`,
        { method: 'POST', json: { content_type: file.type || 'image/jpeg', ext } },
      );
      // Direct PUT to Supabase Storage signed URL.
      const putRes = await fetch(sig.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`);
      await apiFetch<{ patient: Patient }>(`/api/patients/${patientId}`, {
        method: 'PATCH',
        json: { adpm_refusal_photo_path: sig.path },
      });
      return sig.path;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useAdpmRefusalPhotoUrl(patientId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['adpm-refusal-photo', patientId],
    queryFn: () =>
      apiFetch<{ url: string }>(`/api/patients/${patientId}?action=adpm_refusal_photo`),
    staleTime: 60 * 1000 * 5,
  });
}
