type StatusChipProps = {
  status: "connected" | "disconnected" | "warning";
  label?: string;
  className?: string;
};

const DEFAULT_LABEL: Record<StatusChipProps["status"], string> = {
  connected: "CONECTADO",
  disconnected: "NO CONECTADO",
  warning: "REQUIERE ACCION",
};

export default function StatusChip({ status, label, className = "" }: StatusChipProps) {
  const styles =
    status === "connected"
      ? "border-[#1dd1a1] text-[#7fffd4] shadow-[0_0_14px_rgba(29,209,161,0.35)]"
      : status === "warning"
      ? "border-amber-400/70 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.25)]"
      : "border-white/20 text-white/70";

  return (
    <span
      className={`inline-flex items-center rounded-full border bg-[#0B1117] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${styles} ${className}`}
    >
      {label ?? DEFAULT_LABEL[status]}
    </span>
  );
}
