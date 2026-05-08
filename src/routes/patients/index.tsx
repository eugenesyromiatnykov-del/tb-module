import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';

export function PatientsPage() {
  return (
    <div>
      <PageHeader
        title="Пацієнти"
        subtitle="Єдиний реєстр пацієнтів обох локацій"
      />
      <EmptyState
        title="Реєстр буде в Фазі 1"
        description="Завантажте декларантів через «Налаштування → Імпорт декларантів», щоб заповнити список."
      />
    </div>
  );
}
