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
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {helper ? <span className="text-xs text-slate-500">{helper}</span> : null}
      </div>

      <div className="mt-6 space-y-4">
        {data.map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{item.label}</span>
              <span className="text-slate-900">{item.value}</span>
            </div>
            <div className="h-2 rounded-full bg-[#F4F5F7]">
              <div
                className="h-2 rounded-full bg-blue-600"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
            {item.helper ? <div className="text-[11px] text-slate-500">{item.helper}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
