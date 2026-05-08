import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Delete } from 'lucide-react';
import { loginWithPin } from '@/lib/auth';
import { cn } from '@/lib/utils';

const PIN_LENGTH = 8;

export function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    const res = await loginWithPin(value);
    setBusy(false);
    if (res.ok) {
      const target =
        (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';
      navigate(target, { replace: true });
    } else {
      setError(res.error ?? 'Невірний PIN');
      setPin('');
    }
  }

  function onDigit(d: string) {
    if (busy) return;
    setError(null);
    setPin((prev) => {
      if (prev.length >= PIN_LENGTH) return prev;
      const next = prev + d;
      if (next.length === PIN_LENGTH) void submit(next);
      return next;
    });
  }

  function onBackspace() {
    if (busy) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white text-lg font-semibold">
            ТБ
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Модуль ТБ</h1>
          <p className="text-sm text-slate-500">Введіть PIN-код практики</p>
        </div>

        <div className="mb-6 flex items-center justify-center gap-2">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-3 w-3 rounded-full border',
                i < pin.length ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-transparent',
              )}
            />
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <PinKey key={d} value={d} onClick={() => onDigit(d)} disabled={busy} />
          ))}
          <div />
          <PinKey value="0" onClick={() => onDigit('0')} disabled={busy} />
          <button
            type="button"
            onClick={onBackspace}
            disabled={busy || pin.length === 0}
            className="flex h-14 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40"
            aria-label="Стерти"
          >
            <Delete className="h-5 w-5" />
          </button>
        </div>

        {busy && (
          <div className="mt-4 text-center text-sm text-slate-500">Перевіряємо…</div>
        )}
      </div>
    </div>
  );
}

function PinKey({
  value,
  onClick,
  disabled,
}: {
  value: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-14 rounded-xl border border-slate-200 bg-white text-xl font-medium text-slate-800 transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40"
    >
      {value}
    </button>
  );
}
