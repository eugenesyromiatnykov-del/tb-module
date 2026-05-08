import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';

export function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Налаштування"
        subtitle="Імпорт декларантів, email для дайджестів, журнал аудиту"
      />
      <EmptyState
        title="Налаштування зʼявляться у наступних фазах"
        description="Імпорт декларантів — Фаза 1; email-дайджести — Фаза 2; зміна PIN та аудит — Фаза 4."
      />
    </div>
  );
}
