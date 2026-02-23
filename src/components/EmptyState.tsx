export const EmptyState = ({ title, message }: { title: string; message: string }) => {
  return (
    <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-[#F4F5F7] p-10 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-700">{message}</p>
    </div>
  );
};
