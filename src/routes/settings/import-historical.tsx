import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/PageHeader';
import { apiFetch } from '@/lib/api';
import { fetchPatientsForDiff } from '@/hooks/usePatients';
import {
  buildMatchIndex,
  parseDetectedContactsXlsx,
  parseFluoroHistoryXlsx,
  parseRiskGroupsXlsx,
  type FluoroParseResult,
  type RiskParseResult,
  type StatusParseResult,
} from '@/lib/historical-import';
import { LOCATION_LABELS, type LocationId } from '@/types/database';
import { labelOf } from '@/lib/risk-groups';
import { cn } from '@/lib/utils';

type Tab = 'fluoro' | 'risk' | 'status';

export function ImportHistoricalPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('fluoro');

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Імпорт історичних даних"
        subtitle="Перенесення даних зі старих xlsx-таблиць у єдину базу"
        actions={
          <Button variant="secondary" onClick={() => navigate('/settings')}>
            ← Налаштування
          </Button>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <TabBtn active={tab === 'fluoro'} onClick={() => setTab('fluoro')}>
          Флюорографія
        </TabBtn>
        <TabBtn active={tab === 'risk'} onClick={() => setTab('risk')}>
          Групи ризику
        </TabBtn>
        <TabBtn active={tab === 'status'} onClick={() => setTab('status')}>
          Виявлені / Контактні
        </TabBtn>
      </div>

      {tab === 'fluoro' && <FluoroImportSection />}
      {tab === 'risk' && <RiskImportSection />}
      {tab === 'status' && <StatusImportSection />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition',
        active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  );
}

// ── Generic dropzone ───────────────────────────────────────────────────────

function Dropzone({
  hint,
  onFile,
  busy,
}: {
  hint: string;
  onFile: (f: File) => void;
  busy?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition',
        over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100',
        busy && 'pointer-events-none opacity-60',
      )}
    >
      <input
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {busy ? (
        <Loader2 className="mb-2 h-8 w-8 animate-spin text-blue-600" />
      ) : (
        <Upload className="mb-2 h-8 w-8 text-slate-400" />
      )}
      <div className="text-sm font-medium text-slate-700">
        {busy ? 'Обробляємо…' : 'Перетягніть xlsx сюди або натисніть'}
      </div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </label>
  );
}

function StatBlock({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'green' | 'orange' | 'blue' }) {
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

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

// ── 1) Fluoro section ──────────────────────────────────────────────────────

function FluoroImportSection() {
  const [parse, setParse] = useState<FluoroParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: number; matched: number } | null>(null);
  const queryClient = useQueryClient();

  const onFile = useCallback(async (f: File) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await parseFluoroHistoryXlsx(f);
      setParse(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = async () => {
    if (!parse) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ added: number; skipped: number; matched: number }>(
        '/api/migrate',
        { method: 'POST', json: { action: 'fluorography-bulk', rows: parse.rows } },
      );
      setDone(r);
      setParse(null);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!parse && !done && (
        <Card>
          <CardBody>
            <Dropzone
              hint="Очікується файл з листами «Флюорографія Білогіря» та «Флюорографія Залужжя»"
              onFile={onFile}
              busy={busy}
            />
          </CardBody>
        </Card>
      )}

      {parse && (
        <Card>
          <CardHeader>
            <CardTitle>Попередній перегляд</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <StatBlock label="Усього в файлі" value={parse.totalInFile} />
              <StatBlock label="Готово до імпорту" value={parse.rows.length} tone="green" />
              <StatBlock label="Без даты — пропущено" value={parse.skipped} tone="orange" />
            </div>
            <div className="mb-4 text-xs text-slate-500">
              Метчинг по Medics ID. Записи без відповідного пацієнта в реєстрі будуть пропущені сервером.
            </div>
            <div className="flex gap-2">
              <Button onClick={apply} disabled={busy || parse.rows.length === 0}>
                {busy ? 'Імпортуємо…' : `Імпортувати ${parse.rows.length} записів`}
              </Button>
              <Button variant="secondary" onClick={() => setParse(null)}>
                Скасувати
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {done && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <CardTitle>Імпортовано</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label="Додано" value={done.added} tone="green" />
              <StatBlock label="Знайдено пацієнтів" value={done.matched} tone="blue" />
              <StatBlock label="Не знайдено в БД" value={done.skipped} tone="orange" />
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setDone(null)}>
                Імпортувати ще
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {error && <ErrorBox text={error} />}
    </div>
  );
}

// ── 2) Risk groups section ────────────────────────────────────────────────

function RiskImportSection() {
  const [parse, setParse] = useState<RiskParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ patientsUpdated: number; fluoroAdded: number; externalCreated: number } | null>(null);
  const [createExternal, setCreateExternal] = useState(true);
  const [externalLocation, setExternalLocation] = useState<LocationId>('bilohirska');
  const queryClient = useQueryClient();

  const onFile = useCallback(async (f: File) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { patients } = await fetchPatientsForDiff();
      const idx = buildMatchIndex(patients);
      const r = await parseRiskGroupsXlsx(f, idx);
      setParse(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = async () => {
    if (!parse) return;
    setBusy(true);
    setError(null);
    try {
      const create_external = createExternal
        ? parse.externalCandidates.map((e) => ({ ...e, location_id: externalLocation }))
        : [];
      const r = await apiFetch<{ patientsUpdated: number; fluoroAdded: number; externalCreated: number }>(
        '/api/migrate',
        {
          method: 'POST',
          json: { action: 'risk-groups-bulk', updates: parse.updates, create_external },
        },
      );
      setDone(r);
      setParse(null);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!parse && !done && (
        <Card>
          <CardBody>
            <Dropzone
              hint="Очікується файл «Групи Ризику - Туберкульоз» з 14 листами по групах"
              onFile={onFile}
              busy={busy}
            />
          </CardBody>
        </Card>
      )}

      {parse && (
        <Card>
          <CardHeader>
            <CardTitle>Попередній перегляд</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="mb-4 grid grid-cols-4 gap-3">
              <StatBlock label="Усього рядків" value={parse.totalRows} />
              <StatBlock label="Оновити" value={parse.updates.length} tone="green" />
              <StatBlock label="Створити зовнішніх" value={parse.externalCandidates.length} tone="blue" />
              <StatBlock label="Помилкові" value={parse.invalid.length} tone="orange" />
            </div>

            {parse.externalCandidates.length > 0 && (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    checked={createExternal}
                    onChange={(e) => setCreateExternal(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      Створити {parse.externalCandidates.length} зовнішніх пацієнтів
                    </span>
                    <span className="block text-xs text-slate-600">
                      Не знайдені в реєстрі декларантів. Будуть створені зі статусом «Не декларант» з прикріпленими
                      групами ризику та флюоро.
                    </span>
                  </span>
                </label>
                {createExternal && (
                  <div className="mt-3 max-w-xs">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Локація для них</label>
                    <Select
                      value={externalLocation}
                      onChange={(e) => setExternalLocation(e.target.value as LocationId)}
                    >
                      {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
                        <option key={id} value={id}>
                          {LOCATION_LABELS[id]}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-slate-600">
                    Показати список ({parse.externalCandidates.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-700">
                    {parse.externalCandidates.slice(0, 200).map((e, i) => (
                      <li key={i}>
                        • {e.surname} {e.first_name} {e.patronymic ?? ''}{' '}
                        <span className="text-slate-400">({e.birth_date})</span>{' '}
                        → {e.add_social.map(labelOf).join(', ')}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {parse.invalid.length > 0 && (
              <details className="mb-3 rounded-md border border-orange-200 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">
                  Помилкові рядки ({parse.invalid.length}) — без ДН або з нерозпізнаним ПІБ
                </summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-600">
                  {parse.invalid.slice(0, 100).map((u, i) => (
                    <li key={i}>
                      • {u.fullName} <span className="text-slate-400">({u.birth || '—'})</span> → {u.group}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex gap-2">
              <Button
                onClick={apply}
                disabled={
                  busy || (parse.updates.length === 0 && (!createExternal || parse.externalCandidates.length === 0))
                }
              >
                {busy ? 'Імпортуємо…' : 'Застосувати'}
              </Button>
              <Button variant="secondary" onClick={() => setParse(null)}>
                Скасувати
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {done && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <CardTitle>Готово</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label="Оновлено" value={done.patientsUpdated} tone="green" />
              <StatBlock label="Додано флюоро" value={done.fluoroAdded} tone="blue" />
              <StatBlock label="Створено зовнішніх" value={done.externalCreated} tone="blue" />
            </div>
            <div className="mt-4">
              <Button variant="secondary" onClick={() => setDone(null)}>
                Імпортувати ще
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {error && <ErrorBox text={error} />}
    </div>
  );
}

// ── 3) Detected/Contacts section ──────────────────────────────────────────

function StatusImportSection() {
  const [parse, setParse] = useState<StatusParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ statusChanged: number; fluoroAdded: number; sputumAdded: number; externalCreated: number } | null>(null);
  const [createExternal, setCreateExternal] = useState(true);
  const [externalLocation, setExternalLocation] = useState<LocationId>('bilohirska');
  const queryClient = useQueryClient();

  const onFile = useCallback(async (f: File) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { patients } = await fetchPatientsForDiff();
      const idx = buildMatchIndex(patients);
      const r = await parseDetectedContactsXlsx(f, idx);
      setParse(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = async () => {
    if (!parse) return;
    setBusy(true);
    setError(null);
    try {
      const create_external = createExternal
        ? parse.externalCandidates.map((e) => ({ ...e, location_id: externalLocation }))
        : [];
      const r = await apiFetch<{
        statusChanged: number;
        fluoroAdded: number;
        sputumAdded: number;
        externalCreated: number;
      }>('/api/migrate', {
        method: 'POST',
        json: { action: 'status-bulk', updates: parse.updates, create_external },
      });
      setDone(r);
      setParse(null);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!parse && !done && (
        <Card>
          <CardBody>
            <Dropzone
              hint="Очікується файл «Виявлені та Контактні» з листами «Виявлені» та «Контактні»"
              onFile={onFile}
              busy={busy}
            />
          </CardBody>
        </Card>
      )}

      {parse && (
        <Card>
          <CardHeader>
            <CardTitle>Попередній перегляд</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="mb-4 grid grid-cols-4 gap-3">
              <StatBlock label="Усього рядків" value={parse.totalRows} />
              <StatBlock label="Оновити" value={parse.updates.length} tone="green" />
              <StatBlock label="Створити зовнішніх" value={parse.externalCandidates.length} tone="blue" />
              <StatBlock label="Помилкові" value={parse.invalid.length} tone="orange" />
            </div>

            {parse.externalCandidates.length > 0 && (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    checked={createExternal}
                    onChange={(e) => setCreateExternal(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      Створити {parse.externalCandidates.length} зовнішніх пацієнтів
                    </span>
                    <span className="block text-xs text-slate-600">
                      Не знайдені у реєстрі. Зі статусом «Виявлений» / «Контактний», зі своїми флюоро та мокротинням.
                    </span>
                  </span>
                </label>
                {createExternal && (
                  <div className="mt-3 max-w-xs">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Локація</label>
                    <Select
                      value={externalLocation}
                      onChange={(e) => setExternalLocation(e.target.value as LocationId)}
                    >
                      {(Object.keys(LOCATION_LABELS) as LocationId[]).map((id) => (
                        <option key={id} value={id}>
                          {LOCATION_LABELS[id]}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-slate-600">
                    Показати ({parse.externalCandidates.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-700">
                    {parse.externalCandidates.slice(0, 200).map((e, i) => (
                      <li key={i}>
                        • {e.surname} {e.first_name} {e.patronymic ?? ''}{' '}
                        <span className="text-slate-400">({e.birth_date})</span> → {e.tb_status === 'detected' ? 'Виявлений' : 'Контактний'}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={apply}
                disabled={
                  busy ||
                  (parse.updates.length === 0 && (!createExternal || parse.externalCandidates.length === 0))
                }
              >
                {busy ? 'Імпортуємо…' : 'Застосувати'}
              </Button>
              <Button variant="secondary" onClick={() => setParse(null)}>
                Скасувати
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {done && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <CardTitle>Готово</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-4 gap-3">
              <StatBlock label="Статуси" value={done.statusChanged} tone="green" />
              <StatBlock label="Флюоро" value={done.fluoroAdded} tone="blue" />
              <StatBlock label="Мокротиння" value={done.sputumAdded} tone="blue" />
              <StatBlock label="Зовнішніх" value={done.externalCreated} tone="blue" />
            </div>
            <div className="mt-4">
              <Button variant="secondary" onClick={() => setDone(null)}>
                Імпортувати ще
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {error && <ErrorBox text={error} />}
    </div>
  );
}
