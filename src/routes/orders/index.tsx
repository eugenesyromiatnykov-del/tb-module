import { useMemo, useState } from 'react';
import { ExternalLink, Plus, Pencil, Trash2, Loader2, FileText, Search } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import {
  useCreateOrder,
  useDeleteOrder,
  useOrders,
  useUpdateOrder,
  type Order,
  type OrderInput,
} from '@/hooks/useOrders';
import { cn } from '@/lib/utils';

export function OrdersPage() {
  const { data, isLoading, error } = useOrders();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Order | null>(null);
  const [creating, setCreating] = useState(false);

  const orders = data?.orders ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        o.title.toLowerCase().includes(q) ||
        (o.notes ?? '').toLowerCase().includes(q) ||
        (o.category ?? '').toLowerCase().includes(q),
    );
  }, [orders, search]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Накази МОЗ"
        subtitle="Посилання на накази, що зберігаються в Google Drive або іншому сховищі"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Додати наказ
          </Button>
        }
      />

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Пошук по назві, категорії або нотатках"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <div className="text-sm font-medium text-slate-700">
              {search ? 'Нічого не знайдено' : 'Наказів ще немає'}
            </div>
            {!search && (
              <div className="mt-1 text-xs text-slate-500">
                Натисніть «Додати наказ» і вставте посилання.
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <OrderRow key={o.id} order={o} onEdit={() => setEditing(o)} />
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent title="Новий наказ">
          {creating && <OrderForm onClose={() => setCreating(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title="Редагувати наказ">
          {editing && <OrderForm initial={editing} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderRow({ order, onEdit }: { order: Order; onEdit: () => void }) {
  const del = useDeleteOrder();
  return (
    <Card>
      <CardBody className="flex items-start gap-3 py-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
        <div className="flex-1 min-w-0">
          <a
            href={order.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
          >
            <span className="truncate">{order.title}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
          {order.category && (
            <div className="mt-0.5 text-xs text-slate-500">{order.category}</div>
          )}
          {order.notes && (
            <div className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{order.notes}</div>
          )}
          <div className="mt-1 truncate text-[11px] text-slate-400">{order.url}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700"
            aria-label="Редагувати"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Видалити "${order.title}"?`)) del.mutate(order.id);
            }}
            className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
            aria-label="Видалити"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </CardBody>
    </Card>
  );
}

function OrderForm({ initial, onClose }: { initial?: Order; onClose: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const create = useCreateOrder();
  const update = useUpdateOrder();
  const busy = create.isPending || update.isPending;
  const error = (create.error || update.error) as Error | undefined;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: OrderInput = {
      title: title.trim(),
      url: url.trim(),
      category: category.trim() || null,
      notes: notes.trim() || null,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, patch: payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Назва наказу">
        <Input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Наказ МОЗ № 620 від ..."
        />
      </Field>
      <Field label="Посилання (Google Drive або будь-яке інше)">
        <Input
          required
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://drive.google.com/file/d/…"
        />
      </Field>
      <Field label="Категорія (опц.)">
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="напр. Діагностика, Лікування, Реєстрація"
        />
      </Field>
      <Field label="Нотатки (опц.)">
        <textarea
          className={cn(
            'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
          )}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error.message}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={busy}>
          {busy ? 'Зберігаємо…' : initial ? 'Оновити' : 'Додати'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
