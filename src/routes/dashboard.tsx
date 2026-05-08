import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';

export function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Дашборд"
        subtitle="Огляд просрочених флюоро, виявлених та контактних"
      />
      <EmptyState
        title="Дашборд буде в Фазі 2"
        description="Тут зʼявляться віджети «Просрочено», «На цьому тижні», «30 днів» та статистика."
      />
    </div>
  );
}
