type Props = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description }: Props) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="text-base font-medium text-slate-700">{title}</div>
      {description && <div className="mt-2 text-sm text-slate-500">{description}</div>}
    </div>
  );
}
