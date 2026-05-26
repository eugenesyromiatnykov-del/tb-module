import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { Download, Search, Loader2, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { usePatients, FILTER_LABELS, type PatientFilters, type PatientFilter } from '@/hooks/usePatients';
import { exportPatientsXlsx } from '@/lib/xlsx-export';
import { calcAge, formatDateUk, fluoroBucket, daysSince } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import {
  LOCATION_LABELS,
  TB_STATUS_LABELS,
  type Patient,
  type LocationId,
  type TbStatus,
} from '@/types/database';
import { RISK_GROUPS, labelOf } from '@/lib/risk-groups';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const VALID_FILTERS: PatientFilter[] = ['overdue', 'this_week', 'next_30', 'no_fluoro', 'contacts_no_fluoro', 'detected'];

export function PatientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilter = searchParams.get('filter') as PatientFilter | null;
  const filter: PatientFilter | undefined =
    urlFilter && VALID_FILTERS.includes(urlFilter) ? urlFilter : undefined;

  const [location, setLocation] = useState<'' | LocationId>('');
  const [status, setStatus] = useState<'' | TbStatus>('');
  const [group, setGroup] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [archived, setArchived] = useState(false);
  const search = useDebounced(searchInput, 300);

  const filters: PatientFilters = useMemo(
    () => ({
      location: location || undefined,
      status: status || undefined,
      group: group || undefined,
      search: search || undefined,
      archived,
      filter,
    }),
    [location, status, group, search, archived, filter],
  );

  const { data, isLoading, isFetching, error } = usePatients(filters);
  const patients = data?.patients ?? [];

  const clearUrlFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('filter');
    setSearchParams(next, { replace: true });
  };

  const columns = useMemo<ColumnDef<Patient>[]>(
    () => [
      {
        header: 'ПІБ',
        accessorFn: (p) => `${p.surname} ${p.first_name} ${p.patronymic ?? ''}`.trim(),
        cell: (info) => <span className="font-medium text-slate-900">{info.getValue<string>()}</span>,
      },
      {
        header: 'ДН',
        accessorKey: 'birth_date',
        cell: (info) => <span className="text-slate-600">{formatDateUk(info.getValue<string>())}</span>,
      },
      {
        header: 'Вік',
        accessorFn: (p) => calcAge(p.birth_date) ?? '',
        cell: (info) => <span className="text-slate-600">{String(info.getValue() ?? '')}</span>,
      },
      {
        header: 'Амбулаторія',
        accessorKey: 'location_id',
        cell: (info) => {
          const id = info.getValue<LocationId | null>();
          return <span className="text-slate-600">{id ? LOCATION_LABELS[id] : '—'}</span>;
        },
      },
      {
        header: 'Статус',
        accessorKey: 'tb_status',
        cell: (info) => <StatusBadge status={info.getValue<TbStatus>()} />,
      },
      {
        header: 'Групи',
        accessorFn: (p) => [...p.medical_risk_groups, ...p.social_risk_groups],
        cell: (info) => {
          const groups = info.getValue<string[]>();
          if (groups.length === 0) return <span className="text-slate-400">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {groups.slice(0, 2).map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                  title={g}
                >
                  {labelOf(g)}
                </span>
              ))}
              {groups.length > 2 && (
                <span
                  className="text-xs text-slate-400"
                  title={groups.slice(2).map(labelOf).join(', ')}
                >
                  +{groups.length - 2}
                </span>
              )}
            </div>
          );
        },
      },
      {
        header: 'Остання флюоро',
        accessorKey: 'last_fluoro_date',
        cell: (info) => {
          const v = info.getValue<string | null>();
          return <span className="text-slate-600">{v ? formatDateUk(v) : <span className="text-slate-400">—</span>}</span>;
        },
      },
      {
        header: 'Наступна',
        accessorKey: 'next_planned_date',
        cell: ({ row }) => {
          const v = row.original.next_planned_date;
          if (!v) return <span className="text-slate-400">—</span>;
          const bucket = fluoroBucket(v);
          const days = daysSince(v);
          const tone =
            bucket === 'overdue'
              ? 'text-red-700'
              : bucket === 'this_week'
                ? 'text-orange-700'
                : bucket === 'next_30'
                  ? 'text-cyan-700'
                  : 'text-slate-600';
          return (
            <div className={cn('text-sm', tone)}>
              {formatDateUk(v)}
              {bucket === 'overdue' && days != null && (
                <div className="text-xs">просрочено {days} дн.</div>
              )}
              {bucket === 'this_week' && days != null && (
                <div className="text-xs">через {-days} дн.</div>
              )}
            </div>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: patients,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const onExport = () => {
    if (patients.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const parts = ['pacienti'];
    if (filter) parts.push(filter);
    if (location) parts.push(location);
    if (status) parts.push(status);
    parts.push(today);
    exportPatientsXlsx(patients, `${parts.join('_')}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title="Пацієнти"
        subtitle={
          isLoading
            ? 'Завантаження…'
            : `Знайдено: ${patients.length}${isFetching && !isLoading ? ' · оновлення…' : ''}`
        }
        actions={
          <Button onClick={onExport} disabled={patients.length === 0} variant="secondary">
            <Download className="h-4 w-4" /> Експортувати XLSX
          </Button>
        }
      />

      {filter && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span className="text-blue-700">Активний фільтр:</span>
          <span className="font-medium text-blue-900">{FILTER_LABELS[filter]}</span>
          <button
            type="button"
            onClick={clearUrlFilter}
            className="ml-auto rounded p-1 text-blue-700 hover:bg-blue-100"
            aria-label="Зняти фільтр"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Пошук</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="ПІБ або Medics ID"
              className="pl-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-slate-600">Амбулаторія</label>
          <Select value={location} onChange={(e) => setLocation(e.target.value as '' | LocationId)}>
            <option value="">Усі</option>
            {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
              <option key={id} value={id}>
                {LOCATION_LABELS[id]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-slate-600">Статус</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value as '' | TbStatus)}>
            <option value="">Усі</option>
            {(Object.keys(TB_STATUS_LABELS) as TbStatus[]).map((s) => (
              <option key={s} value={s}>
                {TB_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-slate-600">Група ризику</label>
          <Select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Усі</option>
            <optgroup label="Медичні">
              {RISK_GROUPS.filter((g) => g.category === 'medical').map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Соціальні">
              {RISK_GROUPS.filter((g) => g.category === 'social').map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <input
            id="archived"
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <label htmlFor="archived" className="text-sm text-slate-700">
            Показувати архівних
          </label>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {(error as Error).message}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} className="px-4 py-3 font-medium">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-12 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    </td>
                  </tr>
                ) : patients.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-500">
                      Немає пацієнтів за цими фільтрами
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => window.open(`/patients/${row.original.id}`, '_blank', 'noopener')}
                      className={cn(
                        'cursor-pointer border-t border-slate-100 hover:bg-slate-50',
                        row.original.archived && 'opacity-60',
                        rowAccent(row.original),
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 align-top">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function rowAccent(p: Patient): string {
  // Priority: overdue (red) > this_week (orange) > next_30 (cyan) >
  // detected (yellow).
  const bucket = fluoroBucket(p.next_planned_date);
  if (bucket === 'overdue') return 'border-l-4 border-l-red-500';
  if (bucket === 'this_week') return 'border-l-4 border-l-orange-400';
  if (bucket === 'next_30') return 'border-l-4 border-l-cyan-400';
  if (p.tb_status === 'detected') return 'border-l-4 border-l-yellow-400';
  return '';
}

function StatusBadge({ status }: { status: TbStatus }) {
  const tone: Record<TbStatus, string> = {
    risk: 'bg-orange-100 text-orange-800',
    detected: 'bg-yellow-100 text-yellow-800',
    archived: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', tone[status])}>
      {TB_STATUS_LABELS[status]}
    </span>
  );
}
