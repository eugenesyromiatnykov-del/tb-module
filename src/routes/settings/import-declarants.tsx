import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/PageHeader';
import { parseDeclarantsXlsx, type ParseResult } from '@/lib/xlsx-import';
import { computeDiff } from '@/lib/declarants-diff';
import { fetchPatientsForDiff } from '@/hooks/usePatients';
import { apiFetch } from '@/lib/api';
import { LOCATION_LABELS, type DeclarantsDiff, type LocationId } from '@/types/database';
import { cn } from '@/lib/utils';

type Stage = 'idle' | 'parsing' | 'preview' | 'applying' | 'done';

export function ImportDeclarantsPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [locationId, setLocationId] = useState<LocationId>('bilohirska');
  const [file, setFile] = useState<File | null>(null);
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [diff, setDiff] = useState<DeclarantsDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; updated: number; archived: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleFile = useCallback(
    async (f: File) => {
      setError(null);
      setResult(null);
      setFile(f);
      setStage('parsing');
      try {
        const parseResult = await parseDeclarantsXlsx(f, locationId);
        setParse(parseResult);
        if (parseResult.rows.length === 0) {
          setError('У файлі не знайдено жодного валідного рядка');
          setStage('idle');
          return;
        }
        const { patients: existing } = await fetchPatientsForDiff();
        const d = computeDiff(parseResult.rows, existing, locationId);
        setDiff(d);
        setStage('preview');
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Помилка обробки файлу');
        setStage('idle');
      }
    },
    [locationId],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void handleFile(f);
    },
    [handleFile],
  );

  const apply = useMutation({
    mutationFn: async () => {
      if (!diff || !file) throw new Error('Немає даних для застосування');
      return apiFetch<{ added: number; updated: number; archived: number }>(`/api/declarants/apply`, {
        method: 'POST',
        json: {
          locationId,
          filename: file.name,
          add: diff.add,
          update: diff.update,
          archive: diff.archive,
          totalInFile: diff.totalInFile,
        },
      });
    },
    onMutate: () => setStage('applying'),
    onSuccess: (r) => {
      setResult(r);
      setStage('done');
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setStage('preview');
    },
  });

  const reset = () => {
    setStage('idle');
    setFile(null);
    setParse(null);
    setDiff(null);
    setError(null);
    setResult(null);
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Імпорт декларантів"
        subtitle="Завантажте свіжу xlsx-виписку з МІС. Лист «Активні» буде використано як джерело правди."
        actions={
          <Button variant="secondary" onClick={() => navigate('/settings')}>
            ← Налаштування
          </Button>
        }
      />

      {stage === 'idle' || stage === 'parsing' ? (
        <Card>
          <CardBody>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Локація</label>
                <Select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value as LocationId)}
                  disabled={stage === 'parsing'}
                >
                  {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
                    <option key={id} value={id}>
                      {LOCATION_LABELS[id]}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-slate-500">
                  Усі пацієнти з файлу будуть прив'язані до цієї локації.
                </p>
              </div>
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition',
                dragOver
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-slate-50 hover:bg-slate-100',
                stage === 'parsing' && 'opacity-60 pointer-events-none',
              )}
            >
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              {stage === 'parsing' ? (
                <>
                  <Loader2 className="mb-3 h-10 w-10 animate-spin text-blue-600" />
                  <div className="text-sm font-medium text-slate-700">Аналізуємо файл…</div>
                </>
              ) : (
                <>
                  <Upload className="mb-3 h-10 w-10 text-slate-400" />
                  <div className="text-sm font-medium text-slate-700">
                    Перетягніть xlsx сюди або натисніть для вибору
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Очікується експорт з МІС, лист «Активні»
                  </div>
                </>
              )}
            </label>

            {error && (
              <div className="mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {stage === 'preview' && diff && parse ? (
        <PreviewView
          diff={diff}
          parse={parse}
          file={file}
          locationId={locationId}
          applying={apply.isPending}
          error={error}
          onCancel={reset}
          onApply={() => apply.mutate()}
        />
      ) : null}

      {stage === 'applying' ? (
        <Card>
          <CardBody className="flex items-center gap-3 text-slate-700">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            Застосовуємо зміни…
          </CardBody>
        </Card>
      ) : null}

      {stage === 'done' && result ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <CardTitle>Готово</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Додано" value={result.added} tone="green" />
              <Stat label="Оновлено" value={result.updated} tone="blue" />
              <Stat label="Архівовано" value={result.archived} tone="slate" />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => navigate('/patients')}>Перейти до реєстру</Button>
              <Button variant="secondary" onClick={reset}>
                Імпортувати ще
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function PreviewView({
  diff,
  parse,
  file,
  locationId,
  applying,
  error,
  onCancel,
  onApply,
}: {
  diff: DeclarantsDiff;
  parse: ParseResult;
  file: File | null;
  locationId: LocationId;
  applying: boolean;
  error: string | null;
  onCancel: () => void;
  onApply: () => void;
}) {
  const totalChanges = diff.add.length + diff.update.length + diff.archive.length;
  const nothingToDo = totalChanges === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Попередній перегляд змін</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="mb-4 text-sm text-slate-600">
            Файл: <span className="font-medium text-slate-900">{file?.name}</span> →{' '}
            <span className="font-medium text-slate-900">{LOCATION_LABELS[locationId]}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Усього в файлі" value={diff.totalInFile} tone="slate" />
            <Stat label="Додати" value={diff.add.length} tone="green" />
            <Stat label="Оновити" value={diff.update.length} tone="blue" />
            <Stat label="Архівувати" value={diff.archive.length} tone="orange" />
          </div>
          {diff.unchanged > 0 && (
            <div className="mt-3 text-xs text-slate-500">
              Без змін: {diff.unchanged}
            </div>
          )}
        </CardBody>
      </Card>

      {parse.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Попередження ({parse.warnings.length})</CardTitle>
          </CardHeader>
          <CardBody className="max-h-48 overflow-y-auto">
            <ul className="space-y-1 text-xs text-slate-600">
              {parse.warnings.slice(0, 100).map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
              {parse.warnings.length > 100 && (
                <li className="text-slate-400">… +{parse.warnings.length - 100} more</li>
              )}
            </ul>
          </CardBody>
        </Card>
      )}

      {diff.archive.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Будуть архівовані ({diff.archive.length})</CardTitle>
          </CardHeader>
          <CardBody className="max-h-48 overflow-y-auto">
            <ul className="space-y-1 text-sm text-slate-700">
              {diff.archive.slice(0, 50).map((a) => (
                <li key={a.id}>
                  • {a.surname} {a.first_name}{' '}
                  <span className="text-slate-400">({a.medics_id})</span>
                </li>
              ))}
              {diff.archive.length > 50 && (
                <li className="text-slate-400">… +{diff.archive.length - 50} more</li>
              )}
            </ul>
          </CardBody>
        </Card>
      )}

      {error && (
        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={onApply} disabled={applying || nothingToDo}>
          {applying ? 'Застосовуємо…' : nothingToDo ? 'Немає змін' : 'Застосувати'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={applying}>
          Скасувати
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'green' | 'blue' | 'orange';
}) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    green: 'bg-green-50 text-green-800 border-green-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    orange: 'bg-orange-50 text-orange-800 border-orange-200',
  } as const;
  return (
    <div className={cn('rounded-lg border p-3', tones[tone])}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
