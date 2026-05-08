import { Link } from 'react-router-dom';
import { Upload, Mail, Lock, ScrollText, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';

type Item = {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  available: boolean;
  phase?: string;
};

const items: Item[] = [
  {
    to: '/settings/import-declarants',
    icon: Upload,
    title: 'Імпорт декларантів',
    subtitle: 'Завантаження свіжої xlsx-виписки з МІС',
    available: true,
  },
  {
    to: '/settings/email-digest',
    icon: Mail,
    title: 'Email-дайджести',
    subtitle: 'Адресати щотижневого звіту просрочок',
    available: false,
    phase: 'Фаза 2',
  },
  {
    to: '/settings/audit',
    icon: ScrollText,
    title: 'Журнал аудиту',
    subtitle: 'Усі зміни в картках пацієнтів',
    available: false,
    phase: 'Фаза 4',
  },
  {
    to: '/settings/pin',
    icon: Lock,
    title: 'Зміна PIN',
    subtitle: 'Оновлення коду доступу до практики',
    available: false,
    phase: 'Фаза 4',
  },
];

export function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Налаштування" />
      <div className="space-y-2">
        {items.map((it) => (
          <SettingRow key={it.to} item={it} />
        ))}
      </div>
    </div>
  );
}

function SettingRow({ item }: { item: Item }) {
  const Icon = item.icon;
  const content = (
    <Card className="transition hover:border-slate-300">
      <div className="flex items-center gap-4 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-slate-900">{item.title}</div>
            {!item.available && item.phase && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {item.phase}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-500">{item.subtitle}</div>
        </div>
        {item.available && <ChevronRight className="h-5 w-5 text-slate-400" />}
      </div>
    </Card>
  );
  return item.available ? <Link to={item.to}>{content}</Link> : <div className="opacity-60">{content}</div>;
}
