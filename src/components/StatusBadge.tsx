export const StatusBadge = ({ value }: { value?: string | null }) => {
  const normalized = value?.toLowerCase() ?? "unknown";
  const styles: Record<string, string> = {
    connected: "bg-emerald-400/10 text-emerald-200 border-emerald-400/30",
    pending: "bg-[#0894C1]/12 text-[#59E0B8] border-[#3CBDB9]/35",
    disconnected: "bg-rose-500/10 text-rose-200 border-rose-400/30",
    requested: "bg-[#0894C1]/12 text-[#59E0B8] border-[#3CBDB9]/35",
    confirmed: "bg-[#0894C1]/12 text-[#59E0B8] border-[#3CBDB9]/35",
    cancelled: "bg-rose-500/10 text-rose-200 border-rose-400/30",
    active: "bg-[#0894C1]/12 text-[#59E0B8] border-[#3CBDB9]/35",
    paused: "bg-amber-500/10 text-amber-200 border-amber-400/30",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        styles[normalized] ?? "border-white/20 bg-white/5 text-white/75"
      }`}
    >
      {value ?? "unknown"}
    </span>
  );
};
