import type { ReactNode } from "react";

export function BarChart({
  title,
  helper,
  data,
}: {
  title: string;
  helper?: string;
  data: { label: string; value: number; helper?: string }[];
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {helper ? <span className="text-xs text-white/50">{helper}</span> : null}
      </div>

      <div className="mt-6 space-y-4">
        {data.map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>{item.label}</span>
              <span className="text-white">{item.value}</span>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div
                className="h-2 rounded-full bg-[#0894C1]"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
            {item.helper ? <div className="text-[11px] text-white/50">{item.helper}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
