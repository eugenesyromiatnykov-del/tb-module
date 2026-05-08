import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';

export function OrdersPage() {
  return (
    <div>
      <PageHeader title="Накази" subtitle="Бібліотека наказів МОЗ" />
      <EmptyState
        title="Накази будуть в Фазі 4"
        description="Тут зʼявиться список 13 наказів та переглядач PDF/DOCX."
      />
    </div>
  );
}
