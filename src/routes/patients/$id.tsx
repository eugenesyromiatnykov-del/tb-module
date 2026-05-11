import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Loader2, AlertTriangle, FileText } from 'lucide-react';
import { useQuestionnaires } from '@/hooks/useQuestionnaires';
import { RESULT_LABELS, type QuestionnaireResult } from '@/lib/questionnaire';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import {
  useAddFluoro,
  useAddSputum,
  useDeleteFluoro,
  useDeleteSputum,
  usePatient,
  useUpdatePatient,
} from '@/hooks/usePatient';
import { calcAge, formatDateUk } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { MEDICAL_GROUPS, SOCIAL_GROUPS, labelOf } from '@/lib/risk-groups';
import {
  FLUORO_RESULT_LABELS,
  LOCATION_LABELS,
  SPUTUM_TEST_LABELS,
  TB_STATUS_LABELS,
  type FluoroRecord,
  type FluoroResultCode,
  type LocationId,
  type SputumTest,
  type SputumTestType,
  type TbStatus,
} from '@/types/database';

type Tab = 'overview' | 'fluoro' | 'sputum' | 'questionnaires';

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
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

  const { patient, fluorography, sputum_tests } = data;
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
          <Button variant="secondary" onClick={() => navigate('/patients')}>
            <ArrowLeft className="h-4 w-4" /> До реєстру
          </Button>
        }
      />

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
        <TabButton active={tab === 'questionnaires'} onClick={() => setTab('questionnaires')}>
          Опросники
        </TabButton>
      </div>

      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'fluoro' && <FluoroTab patientId={patient.id} records={fluorography} />}
      {tab === 'sputum' && <SputumTab patientId={patient.id} records={sputum_tests} />}
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
          <CardTitle>Опросники (додаток 9)</CardTitle>
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
          <div className="px-5 py-10 text-center text-sm text-slate-500">Опросників ще немає</div>
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

  const setStatus = (status: TbStatus) => {
    update.mutate({ tb_status: status });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Контактні дані</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <Field label="Телефон" value={patient.phone ?? '—'} />
          <Field label="Адреса" value={patient.address ?? '—'} />
          <Field label="Стать" value={patient.gender === 'M' ? 'Чоловіча' : patient.gender === 'F' ? 'Жіноча' : '—'} />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Локація</label>
            <Select
              value={patient.location_id ?? ''}
              onChange={(e) => update.mutate({ location_id: (e.target.value || null) as LocationId | null })}
              disabled={update.isPending}
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
              disabled={update.isPending}
            >
              {(Object.keys(TB_STATUS_LABELS) as TbStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TB_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Соціальні групи ризику</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {SOCIAL_GROUPS.map((g) => {
            const checked = patient.social_risk_groups.includes(g.key);
            return (
              <label key={g.key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={checked}
                  onChange={(e) => toggleSocial(g.key, e.target.checked)}
                  disabled={update.isPending}
                />
                {g.label}
              </label>
            );
          })}
        </CardBody>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Медичні групи ризику</CardTitle>
        </CardHeader>
        <CardBody>
          {patient.medical_risk_groups.length === 0 ? (
            <div className="text-sm text-slate-500">
              Немає (визначається автоматично з діагнозів МІС у Фазі 4)
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {patient.medical_risk_groups.map((k) => (
                <span
                  key={k}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                >
                  {labelOf(k)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 text-xs text-slate-400">
            Можливі: {MEDICAL_GROUPS.map((g) => g.label).join(' · ')}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">{value}</div>
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
          <AddFluoroForm patientId={patientId} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FluoroRow({ patientId, record }: { patientId: string; record: FluoroRecord }) {
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
        <button
          type="button"
          onClick={() => {
            if (confirm('Видалити запис?')) del.mutate(record.id);
          }}
          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
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

function AddFluoroForm({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const [date, setDate] = useState(today());
  const [resultCode, setResultCode] = useState<FluoroResultCode>('normal');
  const [result, setResult] = useState('');
  const [nextPlanned, setNextPlanned] = useState(addYearsIso(today(), 1));
  const add = useAddFluoro(patientId);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate(
          {
            patient_id: patientId,
            date,
            result_code: resultCode,
            result: result.trim() || null,
            next_planned_date: nextPlanned || null,
            notes: null,
          },
          { onSuccess: onClose },
        );
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
      {add.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {(add.error as Error).message}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Зберігаємо…' : 'Зберегти'}
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
          <AddSputumForm patientId={patientId} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SputumRow({ patientId, record }: { patientId: string; record: SputumTest }) {
  const del = useDeleteSputum(patientId);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-slate-900">{formatDateUk(record.date)}</td>
      <td className="px-4 py-2 text-slate-700">{SPUTUM_TEST_LABELS[record.test_type]}</td>
      <td className="px-4 py-2 text-slate-600">{record.result ?? '—'}</td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={() => {
            if (confirm('Видалити запис?')) del.mutate(record.id);
          }}
          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

function AddSputumForm({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const [date, setDate] = useState(today());
  const [testType, setTestType] = useState<SputumTestType>('xpert');
  const [result, setResult] = useState('');
  const add = useAddSputum(patientId);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate(
          {
            patient_id: patientId,
            date,
            test_type: testType,
            result: result.trim() || null,
            notes: null,
          },
          { onSuccess: onClose },
        );
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
      {add.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {(add.error as Error).message}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Скасувати
        </Button>
      </div>
    </form>
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
