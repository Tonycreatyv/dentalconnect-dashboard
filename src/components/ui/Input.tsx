import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("dc-input min-w-0", props.className)} />;
}
