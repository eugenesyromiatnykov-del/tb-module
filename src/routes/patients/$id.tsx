import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Trash2, Loader2, AlertTriangle, FileText } from 'lucide-react';
import { useQuestionnaires } from '@/hooks/useQuestionnaires';
import { RESULT_LABELS, type QuestionnaireResult } from '@/lib/questionnaire';
import { PageHeader } from '@/components/PageHeader';
import { SyncCell } from '@/components/SyncCell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import {
  useAddAdpm,
  useAddFluoro,
  useAddQuantiferon,
  useAddSputum,
  useAdpmRefusalPhotoUrl,
  useCreatePatient,
  useDeleteAdpm,
  useDeleteFluoro,
  useDeletePatient,
  useDeleteQuantiferon,
  useDeleteSputum,
  usePatient,
  useUpdateAdpm,
  useUpdateFluoro,
  useUpdatePatient,
  useUpdateQuantiferon,
  useUpdateSputum,
  useUploadAdpmRefusalPhoto,
} from '@/hooks/usePatient';
import { apiFetch } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { usePatients } from '@/hooks/usePatients';
import type { Patient } from '@/types/database';
import { calcAge, formatDateUk } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { MEDICAL_GROUPS, SOCIAL_GROUPS } from '@/lib/risk-groups';
import {
  FLUORO_RESULT_LABELS,
  LOCATION_LABELS,
  QUANTIFERON_RESULT_LABELS,
  SPUTUM_TEST_LABELS,
  TB_STATUS_LABELS,
  type AdpmVaccination,
  type FluoroRecord,
  type FluoroResultCode,
  type LocationId,
  type QuantiferonResultCode,
  type QuantiferonTest,
  type SputumTest,
  type SputumTestType,
  type TbStatus,
} from '@/types/database';

type Tab = 'overview' | 'fluoro' | 'sputum' | 'quantiferon' | 'adpm' | 'contacts' | 'questionnaires';

const VALID_TABS: Tab[] = [
  'overview', 'fluoro', 'sputum', 'quantiferon', 'adpm', 'contacts', 'questionnaires',
];

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') ?? 'overview') as Tab;
  const [tab, setTabRaw] = useState<Tab>(VALID_TABS.includes(initialTab) ? initialTab : 'overview');
  const setTab = (t: Tab) => {
    setTabRaw(t);
    const next = new URLSearchParams(searchParams);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setSearchParams(next, { replace: true });
  };
  const { data, isLoading, error } = usePatient(id);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <div className="text-slate-700">{(error as Error)?.message ?? 'Не знайдено'}</div>
        <Button variant="secondary" onClick={() => navigate('/patients')}>
          ← До реєстру
        </Button>
      </div>
    );
  }

  const { patient, fluorography, sputum_tests, quantiferon_tests, adpm_vaccinations } = data;
  const fullName = [patient.surname, patient.first_name, patient.patronymic].filter(Boolean).join(' ');
  const age = calcAge(patient.birth_date);

  return (
    <div>
      <PageHeader
        title={fullName}
        subtitle={`${age != null ? `${age} р., ` : ''}${formatDateUk(patient.birth_date)} · ${patient.medics_id ?? '—'}${
          patient.location_id ? ` · ${LOCATION_LABELS[patient.location_id]}` : ''
        }`}
        actions={
          <div className="flex gap-2">
            <DeletePatientButton patientId={patient.id} fullName={fullName} />
            <Button variant="secondary" onClick={() => navigate('/patients')}>
              <ArrowLeft className="h-4 w-4" /> До реєстру
            </Button>
          </div>
        }
      />

      <div className="-mt-2 mb-4 flex items-center gap-2 text-xs text-slate-500">
        <span>Sync:</span>
        <SyncCell at={patient.diagnoses_synced_at} medicsId={patient.medics_id} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Огляд
        </TabButton>
        <TabButton active={tab === 'fluoro'} onClick={() => setTab('fluoro')}>
          Флюоро ({fluorography.length})
        </TabButton>
        <TabButton active={tab === 'sputum'} onClick={() => setTab('sputum')}>
          Мокротиння ({sputum_tests.length})
        </TabButton>
        <TabButton active={tab === 'quantiferon'} onClick={() => setTab('quantiferon')}>
          Квантиферон ({quantiferon_tests.length})
        </TabButton>
        <TabButton active={tab === 'adpm'} onClick={() => setTab('adpm')}>
          АДП-М ({adpm_vaccinations.length})
        </TabButton>
        {showContactsTab(patient) && (
          <TabButton active={tab === 'contacts'} onClick={() => setTab('contacts')}>
            Контакти
          </TabButton>
        )}
        <TabButton active={tab === 'questionnaires'} onClick={() => setTab('questionnaires')}>
          Опитувальники
        </TabButton>
      </div>

      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'fluoro' && <FluoroTab patientId={patient.id} records={fluorography} />}
      {tab === 'sputum' && <SputumTab patientId={patient.id} records={sputum_tests} />}
      {tab === 'quantiferon' && (
        <QuantiferonTab patientId={patient.id} records={quantiferon_tests} />
      )}
      {tab === 'adpm' && (
        <AdpmTab patient={patient} records={adpm_vaccinations} />
      )}
      {tab === 'contacts' && showContactsTab(patient) && (
        <ContactsTab indexPatient={patient} />
      )}
      {tab === 'questionnaires' && <QuestionnairesTab patientId={patient.id} />}
    </div>
  );
}

function QuestionnairesTab({ patientId }: { patientId: string }) {
  const { data, isLoading } = useQuestionnaires({ patient_id: patientId });
  const rows = data?.questionnaires ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Опитувальники (додаток 9)</CardTitle>
          <Link to={`/questionnaires/new?patient_id=${patientId}`}>
            <Button size="sm">
              <Plus className="h-4 w-4" /> Новий
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Опитувальників ще немає</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Дата</th>
                <th className="px-4 py-2 font-medium">Заповнив</th>
                <th className="px-4 py-2 font-medium">Результат</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-700">
                    {new Date(q.filled_at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{q.filled_by ?? '—'}</td>
                  <td className="px-4 py-2">
                    <QResultBadge result={q.result} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link to={`/questionnaires/${q.id}`} className="text-xs text-blue-700 hover:underline">
                      Деталі →
                    </Link>
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

function QResultBadge({ result }: { result: QuestionnaireResult }) {
  const tone: Record<QuestionnaireResult, string> = {
    low_risk: 'bg-green-100 text-green-800',
    needs_xray: 'bg-orange-100 text-orange-800',
    needs_referral: 'bg-red-100 text-red-800',
  };
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', tone[result])}>
      {RESULT_LABELS[result]}
    </span>
  );
}

// avoid "FileText not used" lint warning if no symptom path uses it
void FileText;

// Contacts tab is shown for index TB cases AND for patients who were
// previously treated — both groups need their close contacts tracked.
function showContactsTab(p: Patient): boolean {
  return (
    p.tb_status === 'detected' ||
    (p.medical_risk_groups || []).includes('previously_treated')
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition',
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-600 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  );
}

// ─── Overview ──────────────────────────────────────────────────────────────

function OverviewTab({
  data,
}: {
  data: { patient: import('@/types/database').Patient };
}) {
  const { patient } = data;
  const update = useUpdatePatient(patient.id);

  const toggleSocial = (key: string, on: boolean) => {
    const set = new Set(patient.social_risk_groups);
    if (on) set.add(key);
    else set.delete(key);
    update.mutate({ social_risk_groups: Array.from(set) });
  };

  const toggleMedical = (key: string, on: boolean) => {
    const set = new Set(patient.medical_risk_groups);
    if (on) set.add(key);
    else set.delete(key);
    update.mutate({ medical_risk_groups: Array.from(set) });
  };

  const setStatus = (status: TbStatus) => {
    update.mutate({ tb_status: status });
  };

  const toggleExternal = (checked: boolean) => {
    update.mutate({ is_external: checked });
  };

  // Inline editable text field — saves on blur if value actually changed.
  const TextField = ({
    label, field, type = 'text', placeholder,
  }: { label: string; field: keyof typeof patient; type?: string; placeholder?: string }) => {
    const initial = (patient[field] as string | null) ?? '';
    const [val, setVal] = useState<string>(initial);
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
        <Input
          type={type}
          value={val}
          placeholder={placeholder}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => {
            const next = val.trim() === '' ? null : val.trim();
            if (next !== initial) update.mutate({ [field]: next } as Partial<typeof patient>);
          }}
        />
      </div>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Особисті дані</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <TextField label="Прізвище" field="surname" />
          <TextField label="Імʼя" field="first_name" />
          <TextField label="По батькові" field="patronymic" />
          <TextField label="Дата народження" field="birth_date" type="date" />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Стать</label>
            <Select
              value={patient.gender ?? ''}
              onChange={(e) => update.mutate({ gender: (e.target.value || null) as 'M' | 'F' | null })}
            >
              <option value="">— не вказано —</option>
              <option value="M">Чоловіча</option>
              <option value="F">Жіноча</option>
            </Select>
          </div>
          <TextField label="Medics ID" field="medics_id" placeholder="напр. 3990123" />
          <TextField label="Телефон" field="phone" placeholder="+380…" />
          <div className="sm:col-span-2">
            <TextField label="Адреса (вулиця, №)" field="address" />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label="Населений пункт"
              field="village"
              placeholder="напр. Білогірськ"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Амбулаторія</label>
            <Select
              value={patient.location_id ?? ''}
              onChange={(e) => update.mutate({ location_id: (e.target.value || null) as LocationId | null })}
            >
              <option value="">— не вказано —</option>
              {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
                <option key={id} value={id}>
                  {LOCATION_LABELS[id]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Статус ТБ</label>
            <Select
              value={patient.tb_status}
              onChange={(e) => setStatus(e.target.value as TbStatus)}
            >
              {(Object.keys(TB_STATUS_LABELS) as TbStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TB_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={patient.is_external}
              onChange={(e) => toggleExternal(e.target.checked)}
            />
            Не декларант (зовнішній пацієнт)
          </label>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Нотатки</label>
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              rows={2}
              defaultValue={patient.notes ?? ''}
              onBlur={(e) => {
                const next = e.target.value.trim() === '' ? null : e.target.value;
                if ((next ?? '') !== (patient.notes ?? '')) update.mutate({ notes: next });
              }}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Останні результати</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <SummaryRow
            label="Флюоро / R-ОГК"
            date={patient.last_fluoro_date}
            value={
              patient.last_result_code
                ? FLUORO_RESULT_LABELS[patient.last_result_code]
                : null
            }
            nextDate={patient.next_planned_date}
          />
          <SummaryRow
            label="Мокротиння"
            date={patient.last_sputum_date}
            value={
              patient.last_sputum_test_type
                ? `${SPUTUM_TEST_LABELS[patient.last_sputum_test_type]}${patient.last_sputum_result ? ` — ${patient.last_sputum_result}` : ''}`
                : null
            }
          />
          <SummaryRow
            label="Квантиферон (IGRA)"
            date={patient.last_quantiferon_date}
            value={
              patient.last_quantiferon_result_code
                ? QUANTIFERON_RESULT_LABELS[patient.last_quantiferon_result_code]
                : null
            }
          />
        </CardBody>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Групи ризику</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Медичні
              <span className="ml-2 font-normal normal-case text-slate-400">
                автоматично з діагнозів МІС, можна правити вручну
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {MEDICAL_GROUPS.map((g) => {
                const checked = patient.medical_risk_groups.includes(g.key);
                return (
                  <label key={g.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={checked}
                      onChange={(e) => toggleMedical(g.key, e.target.checked)}
                    />
                    {g.label}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Соціальні
              <span className="ml-2 font-normal normal-case text-slate-400">
                ручний вибір лікаря
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {SOCIAL_GROUPS.map((g) => {
                const checked = patient.social_risk_groups.includes(g.key);
                return (
                  <label key={g.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={checked}
                      onChange={(e) => toggleSocial(g.key, e.target.checked)}
                    />
                    {g.label}
                  </label>
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryRow({
  label,
  date,
  value,
  nextDate,
}: {
  label: string;
  date: string | null;
  value: string | null;
  nextDate?: string | null;
}) {
  if (!date) {
    return (
      <div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="text-sm text-slate-400">—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">
        <span className="font-medium">{formatDateUk(date)}</span>
        {value && <span className="text-slate-600"> · {value}</span>}
      </div>
      {nextDate && (
        <div className="text-xs text-slate-500">наступна: {formatDateUk(nextDate)}</div>
      )}
    </div>
  );
}

// ─── Fluoro ────────────────────────────────────────────────────────────────

function FluoroTab({ patientId, records }: { patientId: string; records: FluoroRecord[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Флюорографія</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Додати
          </Button>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {records.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Немає записів</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Дата</th>
                <th className="px-4 py-2 font-medium">Результат</th>
                <th className="px-4 py-2 font-medium">Опис</th>
                <th className="px-4 py-2 font-medium">Заплановано</th>
                <th className="w-10 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <FluoroRow key={r.id} patientId={patientId} record={r} />
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Додати флюорографію">
          <FluoroForm patientId={patientId} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FluoroRow({ patientId, record }: { patientId: string; record: FluoroRecord }) {
  const [editOpen, setEditOpen] = useState(false);
  const del = useDeleteFluoro(patientId);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-slate-900">{formatDateUk(record.date)}</td>
      <td className="px-4 py-2">
        <FluoroResultBadge code={record.result_code} />
      </td>
      <td className="px-4 py-2 text-slate-600">{record.result ?? '—'}</td>
      <td className="px-4 py-2 text-slate-600">{formatDateUk(record.next_planned_date) || '—'}</td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            aria-label="Редагувати"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Видалити запис?')) del.mutate(record.id);
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            aria-label="Видалити"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent title="Редагувати флюорографію">
            <FluoroForm patientId={patientId} record={record} onClose={() => setEditOpen(false)} />
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function FluoroResultBadge({ code }: { code: FluoroResultCode }) {
  const tone: Record<FluoroResultCode, string> = {
    normal: 'bg-green-100 text-green-800',
    pathology: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
    refused: 'bg-orange-100 text-orange-800',
    unknown: 'bg-slate-100 text-slate-700',
  };
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', tone[code])}>
      {FLUORO_RESULT_LABELS[code]}
    </span>
  );
}

function FluoroForm({
  patientId,
  record,
  onClose,
}: {
  patientId: string;
  record?: FluoroRecord;
  onClose: () => void;
}) {
  const [date, setDate] = useState(record?.date ?? today());
  const [resultCode, setResultCode] = useState<FluoroResultCode>(record?.result_code ?? 'normal');
  const [result, setResult] = useState(record?.result ?? '');
  const [nextPlanned, setNextPlanned] = useState(
    record?.next_planned_date ?? addYearsIso(today(), 1),
  );
  const add = useAddFluoro(patientId);
  const update = useUpdateFluoro(patientId);
  const pending = add.isPending || update.isPending;
  const error = (add.error ?? update.error) as Error | null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const patch = {
          date,
          result_code: resultCode,
          result: result.trim() || null,
          next_planned_date: nextPlanned || null,
        };
        if (record) {
          update.mutate({ id: record.id, patch }, { onSuccess: onClose });
        } else {
          add.mutate(
            { patient_id: patientId, ...patch, notes: null },
            { onSuccess: onClose },
          );
        }
      }}
    >
      <FormField label="Дата проведення">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </FormField>
      <FormField label="Результат">
        <Select value={resultCode} onChange={(e) => setResultCode(e.target.value as FluoroResultCode)}>
          {(Object.keys(FLUORO_RESULT_LABELS) as FluoroResultCode[]).map((c) => (
            <option key={c} value={c}>
              {FLUORO_RESULT_LABELS[c]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Опис (опц.)">
        <Input value={result} onChange={(e) => setResult(e.target.value)} placeholder="напр. без патології" />
      </FormField>
      <FormField label="Наступне обстеження">
        <Input type="date" value={nextPlanned} onChange={(e) => setNextPlanned(e.target.value)} />
      </FormField>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error.message}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}

// ─── Sputum ────────────────────────────────────────────────────────────────

function SputumTab({ patientId, records }: { patientId: string; records: SputumTest[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Тести мокротиння</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Додати
          </Button>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {records.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Немає записів</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Дата</th>
                <th className="px-4 py-2 font-medium">Тест</th>
                <th className="px-4 py-2 font-medium">Результат</th>
                <th className="w-10 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <SputumRow key={r.id} patientId={patientId} record={r} />
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Додати тест мокротиння">
          <SputumForm patientId={patientId} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SputumRow({ patientId, record }: { patientId: string; record: SputumTest }) {
  const [editOpen, setEditOpen] = useState(false);
  const del = useDeleteSputum(patientId);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-slate-900">{formatDateUk(record.date)}</td>
      <td className="px-4 py-2 text-slate-700">{SPUTUM_TEST_LABELS[record.test_type]}</td>
      <td className="px-4 py-2 text-slate-600">{record.result ?? '—'}</td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            aria-label="Редагувати"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Видалити запис?')) del.mutate(record.id);
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            aria-label="Видалити"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent title="Редагувати тест мокротиння">
            <SputumForm patientId={patientId} record={record} onClose={() => setEditOpen(false)} />
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function SputumForm({
  patientId,
  record,
  onClose,
}: {
  patientId: string;
  record?: SputumTest;
  onClose: () => void;
}) {
  const [date, setDate] = useState(record?.date ?? today());
  const [testType, setTestType] = useState<SputumTestType>(record?.test_type ?? 'xpert');
  const [result, setResult] = useState(record?.result ?? '');
  const add = useAddSputum(patientId);
  const update = useUpdateSputum(patientId);
  const pending = add.isPending || update.isPending;
  const error = (add.error ?? update.error) as Error | null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const patch = {
          date,
          test_type: testType,
          result: result.trim() || null,
        };
        if (record) {
          update.mutate({ id: record.id, patch }, { onSuccess: onClose });
        } else {
          add.mutate(
            { patient_id: patientId, ...patch, notes: null },
            { onSuccess: onClose },
          );
        }
      }}
    >
      <FormField label="Дата">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </FormField>
      <FormField label="Тип тесту">
        <Select value={testType} onChange={(e) => setTestType(e.target.value as SputumTestType)}>
          {(Object.keys(SPUTUM_TEST_LABELS) as SputumTestType[]).map((t) => (
            <option key={t} value={t}>
              {SPUTUM_TEST_LABELS[t]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Результат">
        <Input value={result} onChange={(e) => setResult(e.target.value)} placeholder="напр. позитивний / негативний" />
      </FormField>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error.message}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}

// ─── Quantiferon (IGRA) ────────────────────────────────────────────────────

function QuantiferonTab({ patientId, records }: { patientId: string; records: QuantiferonTest[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Квантифероновий тест (IGRA)</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Додати
          </Button>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {records.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Немає записів</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Дата</th>
                <th className="px-4 py-2 font-medium">Результат</th>
                <th className="px-4 py-2 font-medium">Опис / нотатки</th>
                <th className="w-10 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <QuantiferonRow key={r.id} patientId={patientId} record={r} />
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Додати квантифероновий тест">
          <QuantiferonForm patientId={patientId} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function QuantiferonRow({ patientId, record }: { patientId: string; record: QuantiferonTest }) {
  const [editOpen, setEditOpen] = useState(false);
  const del = useDeleteQuantiferon(patientId);
  const tone: Record<QuantiferonResultCode, string> = {
    positive: 'bg-red-100 text-red-800',
    negative: 'bg-green-100 text-green-800',
    indeterminate: 'bg-orange-100 text-orange-800',
    unknown: 'bg-slate-100 text-slate-700',
  };
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-slate-900">{formatDateUk(record.date)}</td>
      <td className="px-4 py-2">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', tone[record.result_code])}>
          {QUANTIFERON_RESULT_LABELS[record.result_code]}
        </span>
      </td>
      <td className="px-4 py-2 text-slate-600">{record.result ?? record.notes ?? '—'}</td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            aria-label="Редагувати"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Видалити запис?')) del.mutate(record.id);
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            aria-label="Видалити"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent title="Редагувати квантифероновий тест">
            <QuantiferonForm
              patientId={patientId}
              record={record}
              onClose={() => setEditOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function QuantiferonForm({
  patientId,
  record,
  onClose,
}: {
  patientId: string;
  record?: QuantiferonTest;
  onClose: () => void;
}) {
  const [date, setDate] = useState(record?.date ?? today());
  const [resultCode, setResultCode] = useState<QuantiferonResultCode>(
    record?.result_code ?? 'negative',
  );
  const [result, setResult] = useState(record?.result ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const add = useAddQuantiferon(patientId);
  const update = useUpdateQuantiferon(patientId);
  const pending = add.isPending || update.isPending;
  const error = (add.error ?? update.error) as Error | null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const patch = {
          date,
          result_code: resultCode,
          result: result.trim() || null,
          notes: notes.trim() || null,
        };
        if (record) {
          update.mutate({ id: record.id, patch }, { onSuccess: onClose });
        } else {
          add.mutate({ patient_id: patientId, ...patch }, { onSuccess: onClose });
        }
      }}
    >
      <FormField label="Дата">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </FormField>
      <FormField label="Результат">
        <Select value={resultCode} onChange={(e) => setResultCode(e.target.value as QuantiferonResultCode)}>
          {(Object.keys(QUANTIFERON_RESULT_LABELS) as QuantiferonResultCode[]).map((c) => (
            <option key={c} value={c}>
              {QUANTIFERON_RESULT_LABELS[c]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Опис (опц.)">
        <Input value={result} onChange={(e) => setResult(e.target.value)} placeholder="напр. TB1: 0.35, TB2: 0.42 МО/мл" />
      </FormField>
      <FormField label="Нотатки (опц.)">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error.message}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}

// ─── АДП-М ─────────────────────────────────────────────────────────────────

function AdpmTab({ patient, records }: { patient: Patient; records: AdpmVaccination[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [contraOpen, setContraOpen] = useState(false);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const update = useUpdatePatient(patient.id);

  const status = patient.adpm_contraindication
    ? 'contraindicated'
    : patient.adpm_refused
    ? 'refused'
    : null;

  const clear = () => {
    if (!confirm('Скинути статус (повернути в чергу на вакцинацію)?')) return;
    update.mutate({
      adpm_contraindication: false,
      adpm_contraindication_reason: null,
      adpm_refused: false,
      adpm_refusal_date: null,
      adpm_refusal_photo_path: null,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Статус щодо АДП-М</CardTitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          {status === 'contraindicated' && (
            <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
              <div className="font-medium text-orange-900">Протипоказання</div>
              {patient.adpm_contraindication_reason && (
                <div className="mt-1 text-orange-800">{patient.adpm_contraindication_reason}</div>
              )}
              <button
                type="button"
                onClick={clear}
                className="mt-2 text-xs text-orange-700 underline hover:text-orange-900"
              >
                Скинути статус
              </button>
            </div>
          )}
          {status === 'refused' && (
            <RefusalCard patient={patient} onClear={clear} />
          )}
          {status === null && (
            <div className="text-slate-600">
              Пацієнт у черзі на вакцинацію (якщо не вакцинований ≥10 років).
            </div>
          )}
          {status === null && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={() => setContraOpen(true)}>
                Позначити протипоказання
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRefuseOpen(true)}>
                Позначити відмову
              </Button>
            </div>
          )}
          <AdpmSummary patient={patient} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Вакцинації АДП-М</CardTitle>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Додати
            </Button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {records.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">Немає записів</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Дата</th>
                  <th className="px-4 py-2 font-medium">Вакцина</th>
                  <th className="px-4 py-2 font-medium">Серія</th>
                  <th className="px-4 py-2 font-medium">Виробник</th>
                  <th className="w-10 px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <AdpmRow key={r.id} patientId={patient.id} record={r} />
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent title="Додати вакцинацію АДП-М">
          <AdpmForm patientId={patient.id} onClose={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={contraOpen} onOpenChange={setContraOpen}>
        <DialogContent title="Протипоказання до АДП-М">
          <ContraindicationForm patient={patient} onClose={() => setContraOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={refuseOpen} onOpenChange={setRefuseOpen}>
        <DialogContent title="Відмова від АДП-М">
          <RefusalForm patient={patient} onClose={() => setRefuseOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdpmSummary({ patient }: { patient: Patient }) {
  if (patient.adpm_contraindication || patient.adpm_refused) return null;
  if (!patient.last_adpm_date) {
    return <div className="text-xs text-slate-500">Дата останньої вакцинації не відома.</div>;
  }
  const next = patient.next_adpm_date;
  let tone = 'text-slate-700';
  let suffix = '';
  if (next) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const m = next.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      const days = Math.round((today.getTime() - d.getTime()) / 86400000);
      if (days > 0) {
        tone = 'text-red-700 font-medium';
        suffix = ' · просрочено';
      } else if (d.getFullYear() === today.getFullYear()) {
        tone = 'text-orange-700 font-medium';
        suffix = ' · цьогоріч';
      }
    }
  }
  return (
    <div className={cn('text-xs', tone)}>
      Остання: {formatDateUk(patient.last_adpm_date)}
      {next && <> · наступна: {formatDateUk(next)}{suffix}</>}
    </div>
  );
}

function RefusalCard({ patient, onClear }: { patient: Patient; onClear: () => void }) {
  const photo = useAdpmRefusalPhotoUrl(patient.id, !!patient.adpm_refusal_photo_path);
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <div className="font-medium text-red-900">
        Відмова{patient.adpm_refusal_date ? ` від ${formatDateUk(patient.adpm_refusal_date)}` : ''}
      </div>
      {patient.adpm_refusal_photo_path && (
        photo.data?.url ? (
          <a
            href={photo.data.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block"
          >
            <img
              src={photo.data.url}
              alt="Підтвердження відмови"
              className="max-h-40 rounded border border-red-200"
            />
          </a>
        ) : (
          <div className="mt-1 text-xs text-red-700">Завантаження фото…</div>
        )
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-red-700 underline hover:text-red-900"
        >
          Скинути статус
        </button>
        <UploadRefusalPhoto patientId={patient.id} label={patient.adpm_refusal_photo_path ? 'Замінити фото' : 'Додати фото'} />
      </div>
    </div>
  );
}

function UploadRefusalPhoto({ patientId, label }: { patientId: string; label: string }) {
  const upload = useUploadAdpmRefusalPhoto(patientId);
  return (
    <label className="cursor-pointer text-xs text-red-700 underline hover:text-red-900">
      {upload.isPending ? 'Завантаження…' : label}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={upload.isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function AdpmRow({ patientId, record }: { patientId: string; record: AdpmVaccination }) {
  const [editOpen, setEditOpen] = useState(false);
  const del = useDeleteAdpm(patientId);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-slate-900">{formatDateUk(record.date)}</td>
      <td className="px-4 py-2 text-slate-700">{record.vaccine_name ?? '—'}</td>
      <td className="px-4 py-2 text-slate-600">{record.lot_number ?? '—'}</td>
      <td className="px-4 py-2 text-slate-600">{record.manufacturer ?? '—'}</td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            aria-label="Редагувати"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Видалити запис?')) del.mutate(record.id);
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            aria-label="Видалити"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent title="Редагувати АДП-М">
            <AdpmForm patientId={patientId} record={record} onClose={() => setEditOpen(false)} />
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function AdpmForm({
  patientId,
  record,
  onClose,
}: {
  patientId: string;
  record?: AdpmVaccination;
  onClose: () => void;
}) {
  const [date, setDate] = useState(record?.date ?? today());
  const [vaccineName, setVaccineName] = useState(record?.vaccine_name ?? '');
  const [manufacturer, setManufacturer] = useState(record?.manufacturer ?? '');
  const [lotNumber, setLotNumber] = useState(record?.lot_number ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const add = useAddAdpm(patientId);
  const update = useUpdateAdpm(patientId);
  const pending = add.isPending || update.isPending;
  const error = (add.error ?? update.error) as Error | null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const patch = {
          date,
          vaccine_name: vaccineName.trim() || null,
          manufacturer: manufacturer.trim() || null,
          lot_number: lotNumber.trim() || null,
          notes: notes.trim() || null,
        };
        if (record) {
          update.mutate({ id: record.id, patch }, { onSuccess: onClose });
        } else {
          add.mutate({ patient_id: patientId, ...patch }, { onSuccess: onClose });
        }
      }}
    >
      <FormField label="Дата вакцинації">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </FormField>
      <FormField label="Назва вакцини (опц.)">
        <Input value={vaccineName} onChange={(e) => setVaccineName(e.target.value)} placeholder="АДП-М" />
      </FormField>
      <FormField label="Виробник (опц.)">
        <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
      </FormField>
      <FormField label="Серія (опц.)">
        <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
      </FormField>
      <FormField label="Нотатки (опц.)">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error.message}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}

function ContraindicationForm({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const [reason, setReason] = useState(patient.adpm_contraindication_reason ?? '');
  const update = useUpdatePatient(patient.id);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          {
            adpm_contraindication: true,
            adpm_contraindication_reason: reason.trim() || null,
            adpm_refused: false,
            adpm_refusal_date: null,
            adpm_refusal_photo_path: null,
          },
          { onSuccess: onClose },
        );
      }}
    >
      <FormField label="Причина протипоказання">
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="напр. алергія на компонент, важка реакція в анамнезі…"
        />
      </FormField>
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}

function RefusalForm({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const [date, setDate] = useState(patient.adpm_refusal_date ?? today());
  const [file, setFile] = useState<File | null>(null);
  const update = useUpdatePatient(patient.id);
  const upload = useUploadAdpmRefusalPhoto(patient.id);
  const pending = update.isPending || upload.isPending;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await update.mutateAsync({
          adpm_refused: true,
          adpm_refusal_date: date || null,
          adpm_contraindication: false,
          adpm_contraindication_reason: null,
        });
        if (file) {
          await upload.mutateAsync(file);
        }
        onClose();
      }}
    >
      <FormField label="Дата відмови">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </FormField>
      <FormField label="Фото підтвердження (опц., можна додати пізніше)">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
      </FormField>
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}

function DeletePatientButton({ patientId, fullName }: { patientId: string; fullName: string }) {
  const navigate = useNavigate();
  const del = useDeletePatient(patientId);
  const onClick = () => {
    const ok = confirm(
      `Видалити пацієнта «${fullName}» з реєстру?\n\nРазом із ним зникнуть усі записи флюоро, мокротиння, квантиферону та АДП-М. Скасувати буде неможливо.\n\nДля «пацієнт не обслуговується більше» краще архівувати (з картки), а не видаляти.`,
    );
    if (!ok) return;
    del.mutate(undefined, {
      onSuccess: () => navigate('/patients'),
    });
  };
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={del.isPending}
      className="!border-red-200 !bg-red-50 !text-red-700 hover:!bg-red-100"
    >
      <Trash2 className="h-4 w-4" />
      {del.isPending ? 'Видалення…' : 'Видалити'}
    </Button>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addYearsIso(iso: string, years: number): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// avoid "unused" warning for Link (kept for future quick navigation if needed)
void Link;

// ─── Contacts tab — only visible for detected patients ──────────────────────

function useContacts(indexPatientId: string) {
  return useQuery({
    queryKey: ['contacts', indexPatientId],
    queryFn: () =>
      apiFetch<{ patients: Patient[] }>(
        `/api/patients?contact_of=${encodeURIComponent(indexPatientId)}`,
      ).then((r) => r.patients),
  });
}

function ContactsTab({ indexPatient }: { indexPatient: Patient }) {
  const { data: contacts, isLoading } = useContacts(indexPatient.id);
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Контактні особи</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Додати контактного
          </Button>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <div className="px-5 py-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : !contacts || contacts.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            Контактних осіб ще не внесено
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ПІБ</th>
                <th className="px-4 py-2 font-medium">ДН</th>
                <th className="px-4 py-2 font-medium">Телефон</th>
                <th className="w-10 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-900">
                    <Link to={`/patients/${c.id}`} className="text-blue-700 hover:underline">
                      {[c.surname, c.first_name, c.patronymic].filter(Boolean).join(' ')}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{formatDateUk(c.birth_date)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{c.phone ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Link to={`/patients/${c.id}`} className="text-xs text-blue-700 hover:underline">
                      Картка →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Новий контактний">
          <AddContactForm indexPatient={indexPatient} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AddContactForm({
  indexPatient,
  onClose,
}: {
  indexPatient: Patient;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setMode('existing')}
          className={cn(
            'flex-1 rounded px-3 py-1.5 text-sm font-medium transition',
            mode === 'existing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          З реєстру
        </button>
        <button
          type="button"
          onClick={() => setMode('new')}
          className={cn(
            'flex-1 rounded px-3 py-1.5 text-sm font-medium transition',
            mode === 'new' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          Новий
        </button>
      </div>
      {mode === 'existing' ? (
        <ExistingContactPicker indexPatient={indexPatient} onClose={onClose} />
      ) : (
        <NewContactForm indexPatient={indexPatient} onClose={onClose} />
      )}
    </div>
  );
}

function ExistingContactPicker({
  indexPatient,
  onClose,
}: {
  indexPatient: Patient;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Patient | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);
  const { data } = usePatients(useMemo(() => (debouncedSearch ? { search: debouncedSearch } : {}), [debouncedSearch]));
  const rows = (data?.patients ?? []).filter((p) => p.id !== indexPatient.id).slice(0, 30);
  const link = useUpdatePatient(selected?.id ?? '');

  const onLink = async () => {
    if (!selected) return;
    const social = Array.from(
      new Set([...(selected.social_risk_groups || []), 'close_contact']),
    );
    await link.mutateAsync({
      contact_of: indexPatient.id,
      social_risk_groups: social,
    });
    onClose();
  };

  return (
    <div className="space-y-3">
      {selected ? (
        <div className="space-y-2">
          <div className="rounded-md border border-slate-200 p-2 text-sm">
            <div className="font-medium text-slate-900">
              {selected.surname} {selected.first_name} {selected.patronymic ?? ''}
            </div>
            <div className="text-xs text-slate-500">
              {selected.birth_date} · {selected.medics_id ?? 'no medics'}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            Пацієнт отримає групу ризику «Близький контакт» та посилання на цього індексного пацієнта.
            Інші його дані не змінюються.
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={onLink} disabled={link.isPending}>
              {link.isPending ? 'Зберігаємо…' : 'Звʼязати як контактного'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSelected(null)}>
              Інший пацієнт
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            placeholder="Пошук ПІБ або Medics ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && rows.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
              {rows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p)}
                  className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                >
                  <div className="font-medium text-slate-900">
                    {p.surname} {p.first_name} {p.patronymic ?? ''}
                  </div>
                  <div className="text-xs text-slate-500">
                    {p.birth_date} · {p.medics_id ?? 'no medics'}
                    {p.contact_of && p.contact_of !== indexPatient.id && (
                      <span className="ml-2 text-orange-600">вже контакт іншого</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
          {search && rows.length === 0 && (
            <div className="text-xs text-slate-500">Нікого не знайдено</div>
          )}
        </div>
      )}
    </div>
  );
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function NewContactForm({
  indexPatient,
  onClose,
}: {
  indexPatient: Patient;
  onClose: () => void;
}) {
  const [surname, setSurname] = useState('');
  const [firstName, setFirstName] = useState('');
  const [patronymic, setPatronymic] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'' | 'M' | 'F'>('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [locationId, setLocationId] = useState<'' | LocationId>(indexPatient.location_id ?? '');
  const [isExternal, setIsExternal] = useState(true);
  const create = useCreatePatient();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          {
            surname: surname.trim(),
            first_name: firstName.trim(),
            patronymic: patronymic.trim() || null,
            birth_date: birthDate,
            gender: gender || null,
            phone: phone.trim() || null,
            address: address.trim() || null,
            location_id: (locationId || null) as LocationId | null,
            tb_status: 'risk',
            contact_of: indexPatient.id,
            social_risk_groups: ['close_contact'],
            is_external: isExternal,
          },
          { onSuccess: onClose },
        );
      }}
    >
      <FormField label="Прізвище">
        <Input required value={surname} onChange={(e) => setSurname(e.target.value)} />
      </FormField>
      <FormField label="Імʼя">
        <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </FormField>
      <FormField label="По батькові">
        <Input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} />
      </FormField>
      <FormField label="Дата народження">
        <Input required type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      </FormField>
      <FormField label="Стать">
        <Select value={gender} onChange={(e) => setGender(e.target.value as '' | 'M' | 'F')}>
          <option value="">— не вказано —</option>
          <option value="M">Чоловіча</option>
          <option value="F">Жіноча</option>
        </Select>
      </FormField>
      <FormField label="Телефон">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380…" />
      </FormField>
      <FormField label="Адреса">
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </FormField>
      <FormField label="Амбулаторія">
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value as '' | LocationId)}>
          <option value="">— не вказано —</option>
          {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
            <option key={id} value={id}>
              {LOCATION_LABELS[id]}
            </option>
          ))}
        </Select>
      </FormField>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={isExternal}
          onChange={(e) => setIsExternal(e.target.checked)}
        />
        Не декларант (зовнішній)
      </label>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
        Контакт автоматично отримає групу ризику «Близький контакт» та статус «В групі ризику».
      </div>
      {create.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {(create.error as Error).message}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Зберігаємо…' : 'Додати'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}
