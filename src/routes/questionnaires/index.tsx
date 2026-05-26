import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, FileText } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/ui/Select';
import { Card, CardBody } from '@/components/ui/Card';
import { useQuestionnaires } from '@/hooks/useQuestionnaires';
import { RESULT_LABELS, type QuestionnaireResult } from '@/lib/questionnaire';
import { cn } from '@/lib/utils';

export function QuestionnairesPage() {
  const [resultFilter, setResultFilter] = useState<'' | QuestionnaireResult>('');
  const { data, isLoading, error } = useQuestionnaires(
    useMemo(() => (resultFilter ? { result: resultFilter } : {}), [resultFilter]),
  );
  const rows = data?.questionnaires ?? [];

  return (
    <div>
      <PageHeader
        title="Опросники (додаток 9)"
        subtitle={
          isLoading
            ? 'Завантаження…'
            : `Усього: ${rows.length}. Новий опросник створюється з картки пацієнта.`
        }
      />

      <div className="mb-4 flex items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="w-60">
          <label className="mb-1 block text-xs font-medium text-slate-600">Результат</label>
          <Select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as '' | QuestionnaireResult)}>
            <option value="">Усі</option>
            {(Object.keys(RESULT_LABELS) as QuestionnaireResult[]).map((r) => (
              <option key={r} value={r}>
                {RESULT_LABELS[r]}
              </option>
            ))}
          </Select>
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
      ) : rows.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <div className="text-sm font-medium text-slate-700">Опросників ще немає</div>
            <div className="mt-1 text-xs text-slate-500">
              Відкрийте картку пацієнта → вкладку «Опросники» → «+ Новий опросник».
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3 font-medium">Пацієнт</th>
                <th className="px-4 py-3 font-medium">Заповнив</th>
                <th className="px-4 py-3 font-medium">Результат</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">
                    {new Date(q.filled_at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-4 py-2 text-slate-900">
                    {q.patient_id ? (
                      <Link to={`/patients/${q.patient_id}`} className="text-blue-700 hover:underline">
                        Переглянути картку
                      </Link>
                    ) : (
                      <span className="text-slate-500">анонімно</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{q.filled_by ?? '—'}</td>
                  <td className="px-4 py-2">
                    <ResultBadge result={q.result} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      to={`/questionnaires/${q.id}`}
                      className="text-sm text-blue-700 hover:underline"
                    >
                      Деталі →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: QuestionnaireResult }) {
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
