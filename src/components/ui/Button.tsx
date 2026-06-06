import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cn(
        "ui-button-base text-safe",
        variant === "primary" && "dc-btn-primary",
        variant === "secondary" && "dc-btn-secondary",
        variant === "ghost" && "text-white/80 hover:bg-white/[0.08]",
        className
      )}
    />
  );
}
