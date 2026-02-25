import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("dc-select", props.className)} />;
}
