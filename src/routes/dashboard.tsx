import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  Stethoscope,
  Users,
  Database,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useDashboardStats, type DashboardStats } from '@/hooks/useDashboardStats';
import { cn } from '@/lib/utils';
import type { PatientFilter } from '@/hooks/usePatients';

type Tone = 'red' | 'orange' | 'cyan' | 'amber' | 'violet' | 'slate';

type Widget = {
  key: PatientFilter | 'last_import' | 'total';
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  value: (s: DashboardStats) => number | string;
  filterTo?: PatientFilter;
  span?: 'full';
};

const WIDGETS: Widget[] = [
  {
    key: 'overdue',
    label: 'Прострочено',
    description: 'next_planned_date в минулому',
    icon: AlertTriangle,
    tone: 'red',
    value: (s) => s.overdue,
    filterTo: 'overdue',
  },
  {
    key: 'this_week',
    label: 'На цьому тижні',
    description: 'Найближчі 7 днів',
    icon: Calendar,
    tone: 'orange',
    value: (s) => s.this_week,
    filterTo: 'this_week',
  },
  {
    key: 'next_30',
    label: 'Найближчі 30 днів',
    description: '8–30 днів',
    icon: CalendarDays,
    tone: 'cyan',
    value: (s) => s.next_30,
    filterTo: 'next_30',
  },
  {
    key: 'detected',
    label: 'Виявлені',
    description: 'tb_status = виявлений',
    icon: Stethoscope,
    tone: 'amber',
    value: (s) => s.detected,
    filterTo: 'detected',
  },
  {
    key: 'contacts_no_fluoro',
    label: 'Контактні без флюоро',
    description: 'Не пройшли обстеження',
    icon: Users,
    tone: 'violet',
    value: (s) => s.contacts_no_fluoro,
    filterTo: 'contacts_no_fluoro',
  },
  {
    key: 'no_fluoro',
    label: 'Без флюоро взагалі',
    description: 'Немає жодного запису',
    icon: Users,
    tone: 'slate',
    value: (s) => s.no_fluoro,
    filterTo: 'no_fluoro',
  },
];

const TONE_STYLES: Record<Tone, { bg: string; text: string; ring: string }> = {
  red: { bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-200 hover:ring-red-300' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-200 hover:ring-orange-300' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'ring-cyan-200 hover:ring-cyan-300' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200 hover:ring-amber-300' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200 hover:ring-violet-300' },
  slate: { bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-200 hover:ring-slate-300' },
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: stats, isLoading, error } = useDashboardStats();

  return (
    <div>
      <PageHeader title="Дашборд" subtitle="Огляд просрочок та поточного стану реєстру" />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {(error as Error).message}
        </div>
      ) : isLoading || !stats ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WIDGETS.map((w) => {
              const t = TONE_STYLES[w.tone];
              const v = w.value(stats);
              const Icon = w.icon;
              const onClick = w.filterTo ? () => navigate(`/patients?filter=${w.filterTo}`) : undefined;
              return (
                <button
                  key={w.key}
                  type="button"
                  onClick={onClick}
                  disabled={!onClick}
                  className={cn(
                    'rounded-xl bg-white p-5 text-left ring-1 transition disabled:cursor-default',
                    t.ring,
                    onClick && 'hover:shadow-sm cursor-pointer',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg', t.bg)}>
                        <Icon className={cn('h-5 w-5', t.text)} />
                      </div>
                      <div className="mt-3 text-sm font-medium text-slate-700">{w.label}</div>
                      {w.description && <div className="mt-0.5 text-xs text-slate-500">{w.description}</div>}
                    </div>
                    <div className={cn('text-3xl font-semibold tabular-nums', t.text)}>{v}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoCard
              icon={TrendingUp}
              label="Активні пацієнти"
              value={stats.totalActive}
              hint="Не архівні, обидві локації"
            />
            <InfoCard
              icon={Database}
              label="Останній імпорт декларантів"
              value={
                stats.lastImport_daysAgo < 0
                  ? 'не було'
                  : stats.lastImport_daysAgo === 0
                    ? 'сьогодні'
                    : `${stats.lastImport_daysAgo} дн. тому`
              }
              hint="Оновлюйте щомісяця"
              warn={stats.lastImport_daysAgo > 35}
            />
          </div>
        </>
      )}
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  hint,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border p-4',
        warn ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-white',
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg',
          warn ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className={cn('text-lg font-semibold', warn ? 'text-orange-800' : 'text-slate-900')}>{value}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}
