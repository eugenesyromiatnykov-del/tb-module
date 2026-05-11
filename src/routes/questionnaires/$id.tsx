import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Trash2, Loader2, FileText, Printer } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { useDeleteQuestionnaire, useQuestionnaire } from '@/hooks/useQuestionnaires';
import {
  RESULT_LABELS,
  SYMPTOM_LABELS,
  FILLED_BY_LABELS,
  type QuestionnaireAnswers,
  type QuestionnaireResult,
  type FilledBy,
  type SymptomKey,
} from '@/lib/questionnaire';
import { cn } from '@/lib/utils';
import { formatDateUk } from '@/lib/date-utils';

export function QuestionnaireDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuestionnaire(id);
  const del = useDeleteQuestionnaire();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-sm text-red-700">{(error as Error)?.message ?? 'Не знайдено'}</div>
    );
  }

  const q = data.questionnaire;
  const a = q.answers as unknown as QuestionnaireAnswers;
  const p = data.patient;
  const needsReferral = q.result === 'needs_referral';
  const needsAnyAction = q.result === 'needs_xray' || q.result === 'needs_referral';

  const handleDelete = async () => {
    if (!confirm('Видалити опросник?')) return;
    await del.mutateAsync(q.id);
    navigate('/questionnaires');
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Опросник додатку 9"
        subtitle={new Date(q.filled_at).toLocaleString('uk-UA', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
        actions={
          <div className="flex gap-2">
            {needsAnyAction && id && (
              <Button onClick={() => window.open(`/referral/${id}`, '_blank')}>
                <Printer className="h-4 w-4" />
                {needsReferral ? 'Направлення до фтизіатра' : 'Направлення на R-ОГК'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/questionnaires')}>
              <ArrowLeft className="h-4 w-4" /> Список
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardBody>
            <ResultBlock result={q.result} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Пацієнт</CardTitle>
          </CardHeader>
          <CardBody>
            {p ? (
              <div className="space-y-1 text-sm">
                <div>
                  <Link to={`/patients/${p.id}`} className="font-medium text-blue-700 hover:underline">
                    {p.surname} {p.first_name} {p.patronymic ?? ''}
                  </Link>
                </div>
                <div className="text-slate-600">
                  ДН {formatDateUk(p.birth_date)}
                  {p.medics_id && ` · Medics ID ${p.medics_id}`}
                </div>
                {p.address && <div className="text-slate-600">{p.address}</div>}
                {p.phone && <div className="text-slate-600">{p.phone}</div>}
              </div>
            ) : (
              <div className="text-sm text-slate-500">Анонімно</div>
            )}
            {q.filled_by && (
              <div className="mt-3 text-xs text-slate-500">
                Заповнив: {FILLED_BY_LABELS[q.filled_by as FilledBy] ?? q.filled_by}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Симптоми</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {(Object.keys(SYMPTOM_LABELS) as SymptomKey[]).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium',
                      a[k] ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-400',
                    )}
                  >
                    {a[k] ? '✓' : '·'}
                  </span>
                  <span className={cn(a[k] ? 'text-slate-900' : 'text-slate-500')}>
                    {SYMPTOM_LABELS[k]}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Анамнез</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm">
            <div>
              Останній контакт з хворим на ТБ:{' '}
              <span className="font-medium">
                {a.last_contact_date ? formatDateUk(a.last_contact_date) : '—'}
              </span>
            </div>
            <div>
              Останній R-ОГК:{' '}
              <span className="font-medium">
                {a.last_xray_date ? formatDateUk(a.last_xray_date) : '—'}
              </span>
            </div>
            <div>
              Позитивний скрин-тест:{' '}
              <span className="font-medium">{a.positive_screening_test ? 'так' : 'ні'}</span>
            </div>
          </CardBody>
        </Card>

        {q.notes && (
          <Card>
            <CardHeader>
              <CardTitle>Нотатки</CardTitle>
            </CardHeader>
            <CardBody className="whitespace-pre-wrap text-sm text-slate-700">{q.notes}</CardBody>
          </Card>
        )}

        <div>
          <Button variant="danger" onClick={handleDelete} disabled={del.isPending}>
            <Trash2 className="h-4 w-4" /> Видалити
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultBlock({ result }: { result: QuestionnaireResult }) {
  const tone =
    result === 'low_risk'
      ? { bg: 'bg-green-50', text: 'text-green-800' }
      : result === 'needs_xray'
        ? { bg: 'bg-orange-50', text: 'text-orange-800' }
        : { bg: 'bg-red-50', text: 'text-red-800' };
  return (
    <div className={cn('flex items-center gap-2 rounded-lg p-3', tone.bg)}>
      <FileText className={cn('h-5 w-5', tone.text)} />
      <span className={cn('text-sm font-medium', tone.text)}>{RESULT_LABELS[result]}</span>
    </div>
  );
}
