import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="dc-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.2em] text-white/60">{label}</p>
        <div className="text-white/60">{icon}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold text-white/95">{value}</div>
      {helper ? <p className="mt-2 text-xs text-white/60">{helper}</p> : null}
    </div>
  );
}
