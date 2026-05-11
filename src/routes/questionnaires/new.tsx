import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, AlertTriangle, CheckCircle2, FileText, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { usePatients } from '@/hooks/usePatients';
import { useCreateQuestionnaire } from '@/hooks/useQuestionnaires';
import {
  calculateResult,
  emptyAnswers,
  FILLED_BY_LABELS,
  RESULT_LABELS,
  SYMPTOM_LABELS,
  type FilledBy,
  type QuestionnaireAnswers,
  type SymptomKey,
} from '@/lib/questionnaire';
import { cn } from '@/lib/utils';

export function NewQuestionnairePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetPatient = searchParams.get('patient_id') ?? null;

  const [anonymous, setAnonymous] = useState(presetPatient ? false : true);
  const [patientId, setPatientId] = useState<string | null>(presetPatient);
  const [filledBy, setFilledBy] = useState<FilledBy>('doctor');
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(emptyAnswers());
  const [notes, setNotes] = useState('');

  const result = useMemo(() => calculateResult(answers), [answers]);
  const create = useCreateQuestionnaire();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await create.mutateAsync({
      patient_id: anonymous ? null : patientId,
      answers: answers as unknown as Record<string, unknown>,
      result,
      filled_by: filledBy,
      notes: notes.trim() || null,
    });
    navigate(`/questionnaires/${created.questionnaire.id}`);
  };

  const toggleSymptom = (k: SymptomKey) =>
    setAnswers((a) => ({ ...a, [k]: !a[k] }));

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Новий опросник"
        subtitle="Скринінг ТБ за додатком 9 (4 симптоми ВООЗ)"
        actions={
          <Button variant="secondary" onClick={() => navigate('/questionnaires')}>
            <ArrowLeft className="h-4 w-4" /> Назад
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Хто заповнює</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Заповнює</label>
                <Select value={filledBy} onChange={(e) => setFilledBy(e.target.value as FilledBy)}>
                  {(Object.keys(FILLED_BY_LABELS) as FilledBy[]).map((k) => (
                    <option key={k} value={k}>
                      {FILLED_BY_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
              />
              Анонімно (без привʼязки до пацієнта)
            </label>
            {!anonymous && (
              <PatientPicker selected={patientId} onSelect={setPatientId} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Симптоми ВООЗ</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {(Object.keys(SYMPTOM_LABELS) as SymptomKey[]).map((k) => (
              <label key={k} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={answers[k]}
                  onChange={() => toggleSymptom(k)}
                />
                <span className="text-sm text-slate-800">{SYMPTOM_LABELS[k]}</span>
              </label>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Анамнез</CardTitle>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Останній контакт з хворим на ТБ
              </label>
              <Input
                type="date"
                value={answers.last_contact_date ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, last_contact_date: e.target.value || null }))}
              />
              <p className="mt-1 text-xs text-slate-500">Контакт &lt; 12 міс → R-ОГК</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Останній R-ОГК
              </label>
              <Input
                type="date"
                value={answers.last_xray_date ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, last_xray_date: e.target.value || null }))}
              />
              <p className="mt-1 text-xs text-slate-500">Не робився / &gt; 12 міс → R-ОГК</p>
            </div>
            <label className="col-span-full flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={answers.positive_screening_test}
                onChange={(e) => setAnswers((a) => ({ ...a, positive_screening_test: e.target.checked }))}
              />
              Позитивний скринінг-тест (тубтест / IGRA)
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Нотатки (опц.)</CardTitle>
          </CardHeader>
          <CardBody>
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Коментар (за бажанням)…"
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <ResultPanel result={result} />
            {create.error && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                {(create.error as Error).message}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button type="submit" disabled={create.isPending || (!anonymous && !patientId)}>
                {create.isPending ? 'Зберігаємо…' : 'Зберегти опросник'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/questionnaires')}>
                Скасувати
              </Button>
            </div>
            {!anonymous && !patientId && (
              <p className="mt-2 text-xs text-orange-700">Оберіть пацієнта або позначте «Анонімно».</p>
            )}
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

function ResultPanel({ result }: { result: ReturnType<typeof calculateResult> }) {
  const tone =
    result === 'low_risk'
      ? { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: CheckCircle2 }
      : result === 'needs_xray'
        ? { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', icon: AlertTriangle }
        : { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: FileText };
  const Icon = tone.icon;
  return (
    <div className={cn('rounded-lg border p-3', tone.bg, tone.border)}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-5 w-5', tone.text)} />
        <span className={cn('text-sm font-medium', tone.text)}>
          Результат: {RESULT_LABELS[result]}
        </span>
      </div>
    </div>
  );
}

function PatientPicker({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = usePatients(useMemo(() => (search ? { search } : {}), [search]));
  const rows = (data?.patients ?? []).slice(0, 20);
  const selectedPatient = rows.find((p) => p.id === selected);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">Пацієнт</label>
      {selected && selectedPatient ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
          <div className="text-sm">
            <span className="font-medium text-slate-900">
              {selectedPatient.surname} {selectedPatient.first_name} {selectedPatient.patronymic ?? ''}
            </span>
            <span className="ml-2 text-slate-500">{selectedPatient.birth_date}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setSearch('');
              setOpen(false);
            }}
            className="text-xs text-blue-700 hover:underline"
          >
            Змінити
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Пошук ПІБ або Medics ID"
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && search && rows.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {rows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSelect(p.id);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <div className="font-medium text-slate-900">
                    {p.surname} {p.first_name} {p.patronymic ?? ''}
                  </div>
                  <div className="text-xs text-slate-500">
                    {p.birth_date} · {p.medics_id ?? 'no medics'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
