import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
};

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-1", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              "min-h-10 min-w-0 rounded-xl px-3 py-2 text-sm font-semibold transition",
              active ? "bg-white/[0.12] text-white shadow-sm" : "text-white/60 hover:bg-white/[0.08] hover:text-white/90",
            )}
          >
            <span className="block truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
