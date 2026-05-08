import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';

export function QuestionnairesPage() {
  return (
    <div>
      <PageHeader title="Опросники" subtitle="Заповнення додатку 9" />
      <EmptyState
        title="Опросник буде в Фазі 3"
        description="Цифровий додаток 9 з автоматичним розрахунком ризику та генерацією направлень."
      />
    </div>
  );
}
