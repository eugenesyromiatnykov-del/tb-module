import { useCallback, useState } from 'react';
import { Upload, Download, Trash2, Loader2, FileText, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { useDeleteOrder, useDownloadOrder, useOrders, useUploadOrder } from '@/hooks/useOrders';
import { cn } from '@/lib/utils';

function formatSize(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrdersPage() {
  const { data, isLoading, error } = useOrders();
  const upload = useUploadOrder();
  const download = useDownloadOrder();
  const del = useDeleteOrder();
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploadError(null);
      for (const f of Array.from(files)) {
        try {
          await upload.mutateAsync(f);
        } catch (e: unknown) {
          setUploadError(`${f.name}: ${e instanceof Error ? e.message : 'помилка'}`);
        }
      }
    },
    [upload],
  );

  const onDownload = async (path: string) => {
    const url = await download.mutateAsync(path);
    window.open(url, '_blank');
  };

  const orders = data?.orders ?? [];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Накази"
        subtitle="Бібліотека наказів МОЗ. Файли зберігаються в захищеному сховищі Supabase."
      />

      <Card className="mb-4">
        <CardBody>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition',
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100',
              upload.isPending && 'pointer-events-none opacity-60',
            )}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            {upload.isPending ? (
              <>
                <Loader2 className="mb-2 h-8 w-8 animate-spin text-blue-600" />
                <div className="text-sm font-medium text-slate-700">Завантажуємо…</div>
              </>
            ) : (
              <>
                <Upload className="mb-2 h-8 w-8 text-slate-400" />
                <div className="text-sm font-medium text-slate-700">
                  Перетягніть файли сюди або натисніть
                </div>
                <div className="mt-1 text-xs text-slate-500">PDF, DOCX, зображення; до 4 МБ на файл</div>
              </>
            )}
          </label>
          {uploadError && (
            <div className="mt-3 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
        </CardBody>
      </Card>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-slate-500">
            Файлів ще немає. Завантажте перший наказ.
          </CardBody>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Назва</th>
                <th className="px-4 py-3 font-medium">Розмір</th>
                <th className="px-4 py-3 font-medium">Завантажено</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.name} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-slate-400" />
                      <span className="font-medium text-slate-900">{o.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatSize(o.size)}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {o.created_at
                      ? new Date(o.created_at).toLocaleDateString('uk-UA')
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onDownload(o.name)}
                        disabled={download.isPending}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700"
                        aria-label="Завантажити"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Видалити "${o.name}"?`)) del.mutate(o.name);
                        }}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        aria-label="Видалити"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
