import { cn } from "../../lib/cn";

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-white/75",
        className
      )}
    >
      {children}
    </span>
  );
}
