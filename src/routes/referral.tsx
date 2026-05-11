import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuestionnaire } from '@/hooks/useQuestionnaires';
import { formatDateUk } from '@/lib/date-utils';
import {
  SYMPTOM_LABELS,
  type QuestionnaireAnswers,
  type SymptomKey,
} from '@/lib/questionnaire';
import { Button } from '@/components/ui/Button';
import { Printer, ArrowLeft } from 'lucide-react';
import { Loader2 } from 'lucide-react';

const LOCATION_LABELS: Record<string, string> = {
  bilohirska: 'Білогірська амбулаторія загальної практики - сімейної медицини',
  zaluzhe: 'Залузька амбулаторія загальної практики - сімейної медицини',
};

export function ReferralPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuestionnaire(id);

  // Auto-focus print dialog could be too aggressive; keep manual via button.
  useEffect(() => {
    document.title = 'Направлення — Модуль ТБ';
    return () => {
      document.title = 'Модуль ТБ';
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="p-6 text-red-700">{(error as Error)?.message ?? 'Не знайдено'}</div>;
  }

  const q = data.questionnaire;
  const p = data.patient;
  const a = q.answers as unknown as QuestionnaireAnswers;
  const needsReferral = q.result === 'needs_referral';
  const todayStr = new Date().toLocaleDateString('uk-UA');

  const fullName = p ? [p.surname, p.first_name, p.patronymic].filter(Boolean).join(' ') : '—';

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Назад
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Друкувати / Зберегти як PDF
        </Button>
      </div>

      <div className="document text-slate-900 print:text-black">
        <div className="text-right text-xs text-slate-700">
          {p?.location_id && (LOCATION_LABELS[p.location_id] ?? p.location_id)}
        </div>
        <h1 className="mt-6 text-center text-2xl font-bold uppercase">
          {needsReferral ? 'Направлення до фтизіатра' : 'Направлення на R-ОГК'}
        </h1>
        <div className="mt-2 text-center text-sm text-slate-700">
          від {todayStr}
        </div>

        <table className="mt-8 w-full text-sm">
          <tbody>
            <Row label="Прізвище, імʼя, по батькові" value={fullName} />
            <Row label="Дата народження" value={p ? formatDateUk(p.birth_date) : '—'} />
            <Row label="Адреса" value={p?.address ?? '—'} />
            <Row label="Телефон" value={p?.phone ?? '—'} />
            <Row label="Medics ID" value={p?.medics_id ?? '—'} />
          </tbody>
        </table>

        <h2 className="mt-8 text-base font-semibold">
          Підстава (за результатами скринінгу за додатком 9 від{' '}
          {new Date(q.filled_at).toLocaleDateString('uk-UA')})
        </h2>

        <ul className="ml-4 mt-3 list-disc space-y-1 text-sm">
          {(Object.keys(SYMPTOM_LABELS) as SymptomKey[])
            .filter((k) => a[k])
            .map((k) => (
              <li key={k}>{SYMPTOM_LABELS[k]}</li>
            ))}
          {a.last_contact_date && (
            <li>Контакт з хворим на ТБ — {formatDateUk(a.last_contact_date)}</li>
          )}
          {a.last_xray_date == null && <li>R-ОГК не проводився</li>}
          {a.last_xray_date && (
            <li>R-ОГК проводився {formatDateUk(a.last_xray_date)} (&gt; 12 міс)</li>
          )}
          {a.positive_screening_test && <li>Позитивний скринінг-тест (тубтест / IGRA)</li>}
        </ul>

        <div className="mt-8 text-sm">
          {needsReferral
            ? 'Направляється до фтизіатра для дообстеження.'
            : 'Направляється на проведення рентгенографії органів грудної клітки.'}
        </div>

        <table className="mt-16 w-full text-sm">
          <tbody>
            <tr>
              <td className="w-1/2 pr-4">
                <div className="border-t border-slate-700 pt-1 text-center text-xs">
                  Лікар (підпис) / прізвище
                </div>
              </td>
              <td className="w-1/2 pl-4">
                <div className="border-t border-slate-700 pt-1 text-center text-xs">
                  Печатка
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <style>{`
        @media print {
          @page { margin: 18mm; size: A4; }
          .document { font-family: 'Times New Roman', serif; }
          body { background: white; }
        }
        .document table td { padding: 4px 0; }
      `}</style>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-slate-200">
      <td className="w-1/3 py-1.5 align-top text-slate-600">{label}:</td>
      <td className="py-1.5 font-medium">{value}</td>
    </tr>
  );
}
