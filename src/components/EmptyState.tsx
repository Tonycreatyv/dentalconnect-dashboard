export const EmptyState = ({ title, message }: { title: string; message: string }) => {
  return (
    <div className="min-w-0 rounded-2xl border border-dashed border-white/10 bg-white/[0.045] p-8 text-center sm:p-10">
      <h3 className="text-safe text-base font-black text-white">{title}</h3>
      <p className="text-safe mt-2 text-sm leading-relaxed text-white/60">{message}</p>
    </div>
  );
};
