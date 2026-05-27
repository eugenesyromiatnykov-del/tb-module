import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { usePatients, type AdpmFilter } from '@/hooks/usePatients';
import { formatDateUk } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { LOCATION_LABELS, type Patient } from '@/types/database';

type Subtab = 'list' | 'contraindicated' | 'refused';

const SUBTAB_TO_FILTER: Record<Subtab, AdpmFilter> = {
  list: 'pending',
  contraindicated: 'contraindicated',
  refused: 'refused',
};

const SUBTAB_LABEL: Record<Subtab, string> = {
  list: 'Список вакцинацій',
  contraindicated: 'Протипокази',
  refused: 'Відмови',
};

const VALID_SUBTABS: Subtab[] = ['list', 'contraindicated', 'refused'];

export function VaccinationsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const subtab: Subtab = VALID_SUBTABS.includes(raw as Subtab) ? (raw as Subtab) : 'list';

  const setSubtab = (t: Subtab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Вакцинація АДП-М" subtitle="Дифтерія / правець, ревакцинація кожні 10 років" />

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {VALID_SUBTABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubtab(t)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition',
              subtab === t
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {SUBTAB_LABEL[t]}
          </button>
        ))}
      </div>

      {subtab === 'list' && <VaccinatedList />}
      {subtab === 'contraindicated' && <ContraindicatedList />}
      {subtab === 'refused' && <RefusedList />}
    </div>
  );
}

// ─── Main list ─────────────────────────────────────────────────────────────
// Patients without contraindication / refusal — i.e. they need vaccination
// (or have one). Color-coded by next vaccination date.
function VaccinatedList() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = usePatients({ adpm: SUBTAB_TO_FILTER.list, search: search || undefined });
  const patients = data?.patients ?? [];

  return (
    <Card>
      <CardBody className="p-0">
        <div className="border-b border-slate-200 p-3">
          <Input
            placeholder="Пошук за ПІБ або Medics ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </div>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : patients.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Немає пацієнтів</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ПІБ</th>
                <th className="px-4 py-2 font-medium">Medics ID</th>
                <th className="px-4 py-2 font-medium">Амбулаторія</th>
                <th className="px-4 py-2 font-medium">Остання АДП-М</th>
                <th className="px-4 py-2 font-medium">Наступна</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <VaccinationRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function VaccinationRow({ p }: { p: Patient }) {
  const tone = nextAdpmTone(p.next_adpm_date, p.last_adpm_date);
  return (
    <tr className={cn('border-t border-slate-100', tone.row)}>
      <td className="px-4 py-2">
        <Link to={`/patients/${p.id}?tab=adpm`} className="font-medium text-blue-700 hover:underline">
          {[p.surname, p.first_name, p.patronymic].filter(Boolean).join(' ')}
        </Link>
      </td>
      <td className="px-4 py-2 font-mono text-xs text-slate-600">{p.medics_id ?? '—'}</td>
      <td className="px-4 py-2 text-slate-600">
        {p.location_id ? LOCATION_LABELS[p.location_id] : '—'}
      </td>
      <td className="px-4 py-2 text-slate-700">
        {p.last_adpm_date ? formatDateUk(p.last_adpm_date) : <span className="italic text-slate-400">не внесено</span>}
      </td>
      <td className={cn('px-4 py-2', tone.cell)}>
        {p.next_adpm_date ? (
          <>
            {formatDateUk(p.next_adpm_date)}
            {tone.suffix && <span className="ml-2 text-xs">{tone.suffix}</span>}
          </>
        ) : (
          <span className="italic text-slate-400">потрібно вакцинувати</span>
        )}
      </td>
    </tr>
  );
}

// Orange = next date is in current year; red = overdue.
function nextAdpmTone(
  nextIso: string | null,
  lastIso: string | null,
): { row: string; cell: string; suffix: string } {
  if (!nextIso) {
    return lastIso
      ? { row: '', cell: 'text-slate-700', suffix: '' }
      : { row: 'bg-red-50', cell: 'text-red-700 font-medium', suffix: 'не вакцинований' };
  }
  const m = nextIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { row: '', cell: 'text-slate-700', suffix: '' };
  const next = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (next < today) {
    return { row: 'bg-red-50', cell: 'text-red-700 font-medium', suffix: 'просрочено' };
  }
  if (next.getFullYear() === today.getFullYear()) {
    return { row: 'bg-orange-50', cell: 'text-orange-700 font-medium', suffix: 'цьогоріч' };
  }
  return { row: '', cell: 'text-slate-700', suffix: '' };
}

// ─── Contraindications ─────────────────────────────────────────────────────
function ContraindicatedList() {
  const { data, isLoading } = usePatients({ adpm: SUBTAB_TO_FILTER.contraindicated });
  const patients = data?.patients ?? [];
  return (
    <Card>
      <CardBody className="p-0">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : patients.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            Немає пацієнтів з протипоказаннями
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ПІБ</th>
                <th className="px-4 py-2 font-medium">Medics ID</th>
                <th className="px-4 py-2 font-medium">Амбулаторія</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <Link to={`/patients/${p.id}?tab=adpm`} className="font-medium text-blue-700 hover:underline">
                      {[p.surname, p.first_name, p.patronymic].filter(Boolean).join(' ')}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{p.medics_id ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {p.location_id ? LOCATION_LABELS[p.location_id] : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Refusals ──────────────────────────────────────────────────────────────
function RefusedList() {
  const { data, isLoading } = usePatients({ adpm: SUBTAB_TO_FILTER.refused });
  const patients = data?.patients ?? [];
  return (
    <Card>
      <CardBody className="p-0">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : patients.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Немає відмов</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ПІБ</th>
                <th className="px-4 py-2 font-medium">Medics ID</th>
                <th className="px-4 py-2 font-medium">Амбулаторія</th>
                <th className="px-4 py-2 font-medium">Фото підтвердження</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const hasPhoto = !!(p as Patient).adpm_refusal_photo_path;
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <Link to={`/patients/${p.id}?tab=adpm`} className="font-medium text-blue-700 hover:underline">
                        {[p.surname, p.first_name, p.patronymic].filter(Boolean).join(' ')}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{p.medics_id ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {p.location_id ? LOCATION_LABELS[p.location_id] : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {hasPhoto ? (
                        <span className="text-xs text-green-700">прикріплене</span>
                      ) : (
                        <span className="text-xs text-red-700">відсутнє</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
