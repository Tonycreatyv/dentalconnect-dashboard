export const EmptyState = ({ title, message }: { title: string; message: string }) => {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-white/60">{message}</p>
    </div>
  );
};
