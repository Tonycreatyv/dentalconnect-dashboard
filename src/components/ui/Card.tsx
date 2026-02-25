import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("dc-card p-5 sm:p-6", className)}>{children}</div>;
}
