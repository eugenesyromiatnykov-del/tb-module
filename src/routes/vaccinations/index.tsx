import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Loader2, Search, ArrowUpDown } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { usePatients, type AdpmFilter } from '@/hooks/usePatients';
import { formatDateUk, calcAge } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { LOCATION_LABELS, type LocationId, type Patient } from '@/types/database';

type AdpmStatusFilter = '' | AdpmFilter;

const STATUS_OPTIONS: { value: AdpmStatusFilter; label: string }[] = [
  { value: '', label: 'Усі' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'this_year', label: 'Ревакцинація цьогоріч' },
  { value: 'pending', label: 'У черзі (без статусу)' },
  { value: 'vaccinated', label: 'Є вакцинація' },
  { value: 'contraindicated', label: 'Протипокази' },
  { value: 'refused', label: 'Відмови' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function VaccinationsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [location, setLocation] = useState<'' | LocationId>('');
  const [adpmStatus, setAdpmStatus] = useState<AdpmStatusFilter>('');
  const search = useDebounced(searchInput, 300);
  const address = useDebounced(addressInput, 300);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      address: address || undefined,
      location: location || undefined,
      adpm: (adpmStatus || undefined) as AdpmFilter | undefined,
    }),
    [search, address, location, adpmStatus],
  );

  const { data, isLoading, isFetching } = usePatients(filters);
  const patients = data?.patients ?? [];

  const [sorting, setSorting] = useState<SortingState>([
    { id: 'next_adpm_date', desc: false },
  ]);

  const columns = useMemo<ColumnDef<Patient>[]>(
    () => [
      {
        id: 'name',
        header: 'ПІБ',
        accessorFn: (p) => `${p.surname} ${p.first_name} ${p.patronymic ?? ''}`.trim(),
        cell: (info) => (
          <Link
            to={`/patients/${info.row.original.id}?tab=adpm`}
            className="font-medium text-blue-700 hover:underline"
          >
            {info.getValue<string>()}
          </Link>
        ),
      },
      {
        id: 'birth_date',
        header: 'Вік',
        accessorFn: (p) => calcAge(p.birth_date) ?? -1,
        cell: (info) => {
          const v = info.getValue<number>();
          return (
            <span className="text-slate-600">
              {v >= 0 ? `${v} р.` : '—'}
            </span>
          );
        },
      },
      {
        id: 'location',
        header: 'Амбулаторія',
        accessorFn: (p) => (p.location_id ? LOCATION_LABELS[p.location_id] : ''),
        cell: (info) => <span className="text-slate-600">{info.getValue<string>() || '—'}</span>,
      },
      {
        id: 'address',
        header: 'Адреса',
        accessorKey: 'address',
        cell: (info) => (
          <span className="text-xs text-slate-600">{info.getValue<string | null>() || '—'}</span>
        ),
      },
      {
        id: 'last_adpm_date',
        header: 'Остання АДП-М',
        accessorFn: (p) => p.last_adpm_date ?? '',
        cell: (info) => {
          const v = info.getValue<string>();
          return v ? (
            <span className="text-slate-700">{formatDateUk(v)}</span>
          ) : (
            <span className="italic text-slate-400">не внесено</span>
          );
        },
      },
      {
        id: 'next_adpm_date',
        header: 'Наступна',
        accessorFn: (p) => p.next_adpm_date ?? '',
        cell: (info) => {
          const p = info.row.original;
          return <NextAdpmCell patient={p} />;
        },
      },
      {
        id: 'status',
        header: 'Статус',
        accessorFn: (p) =>
          p.adpm_contraindication ? 'contra' : p.adpm_refused ? 'refused' : '',
        cell: (info) => {
          const p = info.row.original;
          if (p.adpm_contraindication) {
            return (
              <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                Протипоказання
              </span>
            );
          }
          if (p.adpm_refused) {
            return (
              <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                Відмова
              </span>
            );
          }
          return <span className="text-slate-400">—</span>;
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: patients,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div>
      <PageHeader
        title="Вакцинація АДП-М"
        subtitle={
          isLoading
            ? 'Завантаження…'
            : `Знайдено: ${patients.length}${isFetching && !isLoading ? ' · оновлення…' : ''}`
        }
      />

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
        <div className="w-48">
          <label className="mb-1 block text-xs font-medium text-slate-600">Амбулаторія</label>
          <Select
            value={location}
            onChange={(e) => setLocation(e.target.value as '' | LocationId)}
          >
            <option value="">Усі</option>
            {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
              <option key={id} value={id}>
                {LOCATION_LABELS[id]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-slate-600">Населений пункт</label>
          <Input
            placeholder="напр. Білогірськ"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
          />
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-slate-600">Статус АДП-М</label>
          <Select
            value={adpmStatus}
            onChange={(e) => setAdpmStatus(e.target.value as AdpmStatusFilter)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : patients.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              Немає пацієнтів за вибраними фільтрами
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const sort = h.column.getIsSorted();
                      return (
                        <th key={h.id} className="px-4 py-2 font-medium">
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 hover:text-slate-700"
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <ArrowUpDown
                              className={cn(
                                'h-3 w-3',
                                sort ? 'text-slate-700' : 'text-slate-300',
                              )}
                            />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => {
                  const tone = rowTone(row.original);
                  return (
                    <tr key={row.id} className={cn('border-t border-slate-100', tone)}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-2">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function NextAdpmCell({ patient }: { patient: Patient }) {
  if (patient.adpm_contraindication || patient.adpm_refused) {
    return <span className="text-slate-400">—</span>;
  }
  const next = patient.next_adpm_date;
  if (!next) {
    return <span className="italic text-red-700">потрібно вакцинувати</span>;
  }
  const m = next.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return <span>{formatDateUk(next)}</span>;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d < today) {
    return (
      <span className="font-medium text-red-700">
        {formatDateUk(next)} <span className="text-xs">просрочено</span>
      </span>
    );
  }
  if (d.getFullYear() === today.getFullYear()) {
    return (
      <span className="font-medium text-orange-700">
        {formatDateUk(next)} <span className="text-xs">цьогоріч</span>
      </span>
    );
  }
  return <span className="text-slate-700">{formatDateUk(next)}</span>;
}

function rowTone(p: Patient): string {
  if (p.adpm_contraindication || p.adpm_refused) return '';
  const next = p.next_adpm_date;
  if (!next) return p.last_adpm_date ? '' : 'bg-red-50';
  const m = next.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d < today) return 'bg-red-50';
  if (d.getFullYear() === today.getFullYear()) return 'bg-orange-50';
  return '';
}
