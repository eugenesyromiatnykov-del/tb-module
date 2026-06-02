import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { MedicsIdCell } from '@/components/MedicsIdCell';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { formatDateUk, calcAge } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import {
  INDICATOR_STATE_LABELS,
  LOCATION_LABELS,
  type IndicatorRequiredAction,
  type IndicatorResult,
  type IndicatorState,
  type LocationId,
} from '@/types/database';

// Row shape returned by /api/patients?mode=indicators — flat join of
// indicator_results × patients.
type IndicatorRow = IndicatorResult & {
  patients: {
    id: string;
    medics_id: string | null;
    surname: string;
    first_name: string;
    patronymic: string | null;
    birth_date: string;
    gender: 'M' | 'F' | null;
    location_id: LocationId | null;
    archived: boolean;
    tb_status: string;
    medical_risk_groups: string[];
    social_risk_groups: string[];
    last_indicators_synced_at: string | null;
  };
};

type SummaryRow = {
  rule_id: string;
  rule_name: string | null;
  counts: Partial<Record<IndicatorState, number>>;
  total: number;
};

const STATE_OPTIONS: { value: IndicatorState; label: string }[] = [
  { value: 'overdue', label: 'Прострочено' },
  { value: 'not_done', label: 'Не виконано' },
  { value: 'partial', label: 'Частково' },
  { value: 'completed', label: 'Виконано' },
];

const STATE_PRIORITY: Record<IndicatorState, number> = {
  overdue: 0,
  not_done: 1,
  partial: 2,
  completed: 3,
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function IndicatorsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [location, setLocation] = useState<'' | LocationId>('');
  const [ruleId, setRuleId] = useState<string>('');
  const [states, setStates] = useState<IndicatorState[]>(['overdue', 'not_done']);
  const search = useDebounced(searchInput, 300);

  const summaryQuery = useQuery({
    queryKey: ['indicators-summary', location],
    queryFn: () =>
      apiFetch<{ summary: SummaryRow[] }>(
        `/api/patients?mode=indicators_summary${location ? `&location=${location}` : ''}`,
      ),
  });

  const listQuery = useQuery({
    queryKey: ['indicators-rows', { search, location, ruleId, states }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('mode', 'indicators');
      if (search) params.set('search', search);
      if (location) params.set('location', location);
      if (ruleId) params.set('rule_id', ruleId);
      if (states.length > 0) params.set('state', states.join(','));
      return apiFetch<{ rows: IndicatorRow[] }>(`/api/patients?${params.toString()}`);
    },
  });

  const summary = summaryQuery.data?.summary ?? [];
  const rows = listQuery.data?.rows ?? [];

  // Sort: each indicator row by state priority (overdue first), then by patient surname.
  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const sp = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
        if (sp !== 0) return sp;
        return a.patients.surname.localeCompare(b.patients.surname, 'uk');
      }),
    [rows],
  );

  const ruleOptions = useMemo(() => {
    return summary.map((s) => ({
      value: s.rule_id,
      label: s.rule_name ?? s.rule_id,
    }));
  }, [summary]);

  return (
    <div>
      <PageHeader
        title="Індикатори якості"
        subtitle={
          listQuery.isLoading
            ? 'Завантаження…'
            : `Знайдено записів: ${rows.length}${listQuery.isFetching && !listQuery.isLoading ? ' · оновлення…' : ''}`
        }
      />

      {/* Aggregate stats per rule */}
      <Card className="mb-4">
        <CardBody className="p-0">
          {summaryQuery.isLoading ? (
            <div className="flex h-16 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          ) : summary.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-slate-500">
              Ще немає проаналізованих пацієнтів. Запусти синхронізацію — після першого
              «Проаналізувати» в розширенні дані з'являться тут.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
              {summary.map((s) => {
                const pct = (st: IndicatorState) =>
                  s.total > 0 ? Math.round(((s.counts[st] ?? 0) / s.total) * 100) : 0;
                return (
                  <button
                    type="button"
                    key={s.rule_id}
                    onClick={() => setRuleId((cur) => (cur === s.rule_id ? '' : s.rule_id))}
                    className={cn(
                      'flex flex-col gap-2 bg-white p-4 text-left transition hover:bg-slate-50',
                      ruleId === s.rule_id && 'bg-blue-50 hover:bg-blue-100',
                    )}
                  >
                    <div className="text-sm font-medium text-slate-900">
                      {s.rule_name ?? s.rule_id}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>Всього: {s.total}</span>
                    </div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-emerald-500" style={{ width: `${pct('completed')}%` }} />
                      <div className="bg-blue-400" style={{ width: `${pct('partial')}%` }} />
                      <div className="bg-amber-500" style={{ width: `${pct('not_done')}%` }} />
                      <div className="bg-red-500" style={{ width: `${pct('overdue')}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Pill state="completed" count={s.counts.completed ?? 0} />
                      <Pill state="partial" count={s.counts.partial ?? 0} />
                      <Pill state="not_done" count={s.counts.not_done ?? 0} />
                      <Pill state="overdue" count={s.counts.overdue ?? 0} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

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
          <Select value={location} onChange={(e) => setLocation(e.target.value as '' | LocationId)}>
            <option value="">Усі</option>
            {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
              <option key={id} value={id}>
                {LOCATION_LABELS[id]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-64">
          <label className="mb-1 block text-xs font-medium text-slate-600">Індикатор</label>
          <Select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            <option value="">Усі</option>
            {ruleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-64">
          <label className="mb-1 block text-xs font-medium text-slate-600">Стан</label>
          <MultiSelect
            options={STATE_OPTIONS}
            selected={states}
            onChange={(next) => setStates(next as IndicatorState[])}
            placeholder="Усі"
          />
        </div>
        {(ruleId || states.length > 0 || search || location) && (
          <Button
            variant="ghost"
            onClick={() => {
              setRuleId('');
              setStates([]);
              setSearchInput('');
              setLocation('');
            }}
          >
            Скинути
          </Button>
        )}
      </div>

      <Card>
        <CardBody className="p-0">
          {listQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              Немає записів за вибраними фільтрами
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sortedRows.map((row) => (
                <IndicatorRowItem key={row.id} row={row} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Pill({ state, count }: { state: IndicatorState; count: number }) {
  const cls = {
    completed: 'bg-emerald-100 text-emerald-800',
    overdue: 'bg-red-100 text-red-800',
    partial: 'bg-blue-100 text-blue-800',
    not_done: 'bg-amber-100 text-amber-800',
  }[state];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', cls)}>
      {INDICATOR_STATE_LABELS[state]}: {count}
    </span>
  );
}

function StateBadge({ state }: { state: IndicatorState }) {
  const cls = {
    completed: 'bg-emerald-100 text-emerald-800',
    overdue: 'bg-red-100 text-red-800',
    partial: 'bg-blue-100 text-blue-800',
    not_done: 'bg-amber-100 text-amber-800',
  }[state];
  const icon = { completed: '✓', overdue: '⚠', partial: '½', not_done: '·' }[state];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', cls)}>
      <span>{icon}</span>
      {INDICATOR_STATE_LABELS[state]}
    </span>
  );
}

function IndicatorRowItem({ row }: { row: IndicatorRow }) {
  const [open, setOpen] = useState(false);
  const p = row.patients;
  const age = calcAge(p.birth_date);
  const fullName = `${p.surname} ${p.first_name} ${p.patronymic ?? ''}`.trim();
  const actions = Array.isArray(row.required_actions) ? row.required_actions : [];
  const todos = actions.filter(
    (a) => !a.isRecommendedReferral && !a.isAlternative && (!a.isCompleted || a.isExpired),
  );
  const completedActions = actions.filter((a) => a.isCompleted && !a.isAlternative);
  const recommended = actions.filter((a) => a.isRecommendedReferral);

  return (
    <div className={cn('px-4 py-3 transition', open && 'bg-slate-50')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium text-slate-900">{fullName}</span>
            <span className="text-xs text-slate-500">{age != null ? `${age} р.` : ''}</span>
            <MedicsIdCell id={p.medics_id} />
            {p.location_id && (
              <span className="text-xs text-slate-500">
                {LOCATION_LABELS[p.location_id]}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className="font-medium text-slate-800">{row.rule_name ?? row.rule_id}</span>
            <StateBadge state={row.state} />
            <span>
              {row.completed_count}/{row.total_count} дій
            </span>
            {row.last_date && <span>· ост.: {formatDateUk(row.last_date)}</span>}
            {row.next_date && <span>· наст.: {formatDateUk(row.next_date)}</span>}
            {row.frequency_months && <span>· {row.frequency_months} міс.</span>}
          </div>
        </div>
        <a
          href={`/patients/${p.id}`}
          target="_blank"
          rel="noopener"
          onClick={(e) => e.stopPropagation()}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="Картка пацієнта"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2">
          {row.applicability_reason && (
            <div className="sm:col-span-2">
              <div className="font-medium text-slate-700">Чому застосовується:</div>
              <div className="text-slate-600">{row.applicability_reason}</div>
            </div>
          )}
          <ActionList title="Виконано" actions={completedActions} tone="ok" />
          <ActionList title="Потрібно зробити" actions={todos} tone="todo" />
          {recommended.length > 0 && (
            <ActionList title="Рекомендовані направлення" actions={recommended} tone="info" />
          )}
          {row.details && row.details.length > 0 && (
            <div className="sm:col-span-2">
              <div className="font-medium text-slate-700">Деталі:</div>
              <ul className="list-inside list-disc text-slate-600">
                {row.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-slate-400 sm:col-span-2">
            Проаналізовано: {formatRelative(row.analyzed_at)}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionList({
  title,
  actions,
  tone,
}: {
  title: string;
  actions: IndicatorRequiredAction[];
  tone: 'ok' | 'todo' | 'info';
}) {
  if (actions.length === 0) return null;
  const headerCls = {
    ok: 'text-emerald-700',
    todo: 'text-red-700',
    info: 'text-slate-700',
  }[tone];
  return (
    <div>
      <div className={cn('font-medium', headerCls)}>{title}:</div>
      <ul className="mt-1 space-y-1">
        {actions.map((a, i) => (
          <li key={`${a.code}-${i}`} className="flex items-baseline gap-2 text-slate-700">
            <span
              className={cn(
                'mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                a.isCompleted && !a.isExpired
                  ? 'bg-emerald-500'
                  : a.isExpired
                    ? 'bg-amber-500'
                    : 'bg-red-500',
              )}
            />
            <span>
              {a.name}
              {a.value != null && a.value !== '' && (
                <span className="ml-1 text-slate-500">= {String(a.value)}</span>
              )}
              {a.date && (
                <span className="ml-1 text-slate-400">
                  ({formatDateUk(a.date)}
                  {a.daysAgo != null && <span> · {a.daysAgo} дн.</span>}
                  {a.isExpired && <span className="text-amber-600"> · протерміновано</span>})
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 86400000;
  if (diff < 60 * 60 * 1000) return 'щойно';
  if (diff < day) return 'сьогодні';
  if (diff < 2 * day) return 'вчора';
  if (diff < 7 * day) return `${Math.floor(diff / day)} дн. тому`;
  return formatDateUk(iso);
}
