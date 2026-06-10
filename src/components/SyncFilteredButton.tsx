import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { useExtensionDevice } from '@/hooks/useExtensionDevice';
import type { Patient } from '@/types/database';
import type { SyncJob } from '@/routes/sync';

// Creates a sync_job over just the patients currently visible (i.e. matching
// the filters on /patients or /vaccinations). Doctor's workflow: filter to a
// village + risk group, hit this button, batch runs only those.
//
// If there's already an active job, button is disabled with hint.
export function SyncFilteredButton({ patients }: { patients: Patient[] }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const device = useExtensionDevice();

  // Surface whether something's already running, so we can tell the doctor
  // it'll be auto-paused (no longer a hard block).
  const { data: activeJob } = useQuery({
    queryKey: ['sync-job-active'],
    queryFn: () => apiFetch<{ job: SyncJob | null }>(`/api/patients?mode=sync_job`),
    refetchInterval: 5000,
  });
  const willInterrupt = !!activeJob?.job;

  const eligible = patients.filter((p) => !!p.medics_id);
  const count = eligible.length;

  const onClick = async () => {
    if (busy || count === 0) return;
    const interruptMsg = willInterrupt
      ? `\n\n⚠ Поточну синхронізацію буде поставлено на паузу — продовжите вручну з /sync.`
      : '';
    const ok = confirm(
      `Запустити синхронізацію по ${count} пацієнтах з поточної вибірки?${interruptMsg}\n\n` +
        `Прогрес відображатиметься на сторінці «Синхронізація».`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const ids = eligible.map((p) => p.medics_id!).filter(Boolean);
      await apiFetch(`/api/patients?mode=sync_job`, {
        method: 'POST',
        json: {
          action: 'start',
          scope: 'subset',
          medics_id_list: ids,
          // Pin to THIS device so the nurse's laptop on the same Wi-Fi
          // doesn't grab the job. Null when the extension isn't installed
          // here yet — backend falls back to first-come-first-served.
          device_id: device.id,
          device_label: device.label,
        },
      });
      // Wake the extension SW immediately (otherwise it idles up to 30 s
      // before the next chrome.alarms tick notices our new job). The
      // tb-module-bridge content script forwards this to the SW.
      try { window.dispatchEvent(new CustomEvent('tb-sync-poke')); } catch (_) {}
      navigate('/sync');
    } catch (e) {
      alert(`Не вдалось запустити: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={busy || count === 0}
      title={
        count === 0
          ? 'У вибірці немає пацієнтів з Medics ID'
          : willInterrupt
            ? `Синхронізувати ${count} пацієнтів — поточну синхронізацію буде поставлено на паузу`
            : `Синхронізувати ${count} пацієнтів з поточної вибірки`
      }
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {busy ? 'Створюємо…' : `Синхронізувати (${count})`}
    </Button>
  );
}
