import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type Order = {
  id: string;
  title: string;
  url: string;
  notes: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderInput = {
  title: string;
  url: string;
  notes?: string | null;
  category?: string | null;
};

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => apiFetch<{ orders: Order[] }>('/api/orders'),
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderInput) =>
      apiFetch<{ order: Order }>('/api/orders', { method: 'POST', json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<OrderInput> }) =>
      apiFetch<{ order: Order }>(`/api/orders?id=${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/orders?id=${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
}
