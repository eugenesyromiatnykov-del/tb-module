import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Syringe,
  RefreshCw,
  ListChecks,
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { logout } from '@/lib/auth';

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

const items: Item[] = [
  { to: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/patients', label: 'Пацієнти', icon: Users },
  { to: '/vaccinations', label: 'Вакцинація', icon: Syringe },
  { to: '/indicators', label: 'Індикатори', icon: ListChecks },
  { to: '/sync', label: 'Синхронізація', icon: RefreshCw },
  { to: '/orders', label: 'Накази', icon: BookOpen },
  { to: '/settings', label: 'Налаштування', icon: SettingsIcon },
];

export function Sidebar() {
  async function onLogout() {
    await logout();
    window.location.href = '/login';
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-semibold">
          ТБ
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-slate-900">Модуль ТБ</div>
          <div className="text-xs text-slate-500">Управління випадками</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4" />
          Вийти
        </button>
      </div>
    </aside>
  );
}
