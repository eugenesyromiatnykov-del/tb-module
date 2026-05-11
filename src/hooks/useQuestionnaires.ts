import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { Questionnaire } from '@/types/database';
import type { QuestionnaireResult } from '@/lib/questionnaire';

export type QuestionnaireFilters = {
  patient_id?: string;
  result?: QuestionnaireResult;
};

function buildQs(f: QuestionnaireFilters): string {
  const p = new URLSearchParams();
  if (f.patient_id) p.set('patient_id', f.patient_id);
  if (f.result) p.set('result', f.result);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useQuestionnaires(filters: QuestionnaireFilters = {}) {
  return useQuery({
    queryKey: ['questionnaires', filters],
    queryFn: () =>
      apiFetch<{ questionnaires: Questionnaire[] }>(`/api/questionnaires${buildQs(filters)}`),
  });
}

export function useQuestionnaire(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['questionnaire', id],
    queryFn: () =>
      apiFetch<{
        questionnaire: Questionnaire;
        patient: {
          id: string;
          surname: string;
          first_name: string;
          patronymic: string | null;
          birth_date: string;
          location_id: string | null;
          address: string | null;
          phone: string | null;
          medics_id: string | null;
        } | null;
      }>(`/api/questionnaires?id=${id}`),
  });
}

export function useCreateQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      patient_id: string | null;
      answers: Record<string, unknown>;
      result: QuestionnaireResult;
      filled_by: string | null;
      notes: string | null;
    }) => apiFetch<{ questionnaire: Questionnaire }>('/api/questionnaires', { method: 'POST', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
    },
  });
}

export function useDeleteQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/questionnaires?id=${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
    },
  });
}
