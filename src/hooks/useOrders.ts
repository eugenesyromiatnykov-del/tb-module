import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type OrderFile = {
  name: string;
  size: number | null;
  mime_type: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => apiFetch<{ orders: OrderFile[] }>('/api/orders?action=list'),
  });
}

export function useDownloadOrder() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { url } = await apiFetch<{ url: string }>(
        `/api/orders?action=download&path=${encodeURIComponent(path)}`,
      );
      return url;
    },
  });
}

export function useUploadOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const buf = await file.arrayBuffer();
      const base64 = bytesToBase64(new Uint8Array(buf));
      return apiFetch<{ ok: boolean; path: string }>('/api/orders', {
        method: 'POST',
        json: {
          filename: file.name,
          content_base64: base64,
          mime_type: file.type || 'application/octet-stream',
        },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      apiFetch<void>(`/api/orders?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
