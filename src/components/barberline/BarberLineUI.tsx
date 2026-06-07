import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function BarberLinePageShell({
  title,
  subtitle,
  eyebrow,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-5xl space-y-5 px-4 py-5 text-[#F0F4F8] md:px-6", className)}>
      <div className="flex min-w-0 items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <div className="bl-eyebrow">{eyebrow}</div> : null}
          <h1 className="mt-1 text-xl font-black tracking-tight text-[#F5F7FA]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-[#A4AAB3]">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function BarberLineCard({
  children,
  className,
  asButton = false,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  asButton?: boolean;
  onClick?: () => void;
}) {
  const classes = cn(
    "rounded-2xl border border-[#252A30] bg-[#121417] text-left shadow-[0_14px_36px_rgba(0,0,0,0.22)] transition",
    onClick ? "hover:border-[#18C37E]/25 hover:bg-[#141820]" : "",
    className,
  );
  if (asButton || onClick) {
    return (
      <button type="button" onClick={onClick} className={cn("w-full", classes)}>
        {children}
      </button>
    );
  }
  return <div className={classes}>{children}</div>;
}

export function BarberLineButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const variants = {
    primary: "bg-[#18C37E] text-white hover:bg-[#15AE6F] shadow-lg shadow-[#18C37E]/10",
    secondary: "border border-[#252A30] bg-[#121417] text-[#A4AAB3] hover:border-white/15 hover:text-[#F5F7FA] hover:bg-white/[0.04]",
    ghost: "text-[#A4AAB3] hover:bg-white/[0.05] hover:text-[#F5F7FA]",
    danger: "border border-red-900/20 text-red-500/70 hover:bg-red-950/15 hover:text-red-400",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function BarberLineInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-xl border border-[#252A30] bg-[#0A0C0F] px-3.5 py-2.5 text-sm text-[#F5F7FA] outline-none transition placeholder:text-[#6F7680] focus:border-[#18C37E]/40",
        props.className,
      )}
    />
  );
}

export function BarberLineSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-xl border border-[#252A30] bg-[#0A0C0F] px-3.5 py-2.5 text-sm text-[#F5F7FA] outline-none transition focus:border-[#18C37E]/40",
        props.className,
      )}
    />
  );
}

export function BarberLineTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-xl border border-[#252A30] bg-[#0A0C0F] px-3.5 py-2.5 text-sm text-[#F5F7FA] outline-none transition placeholder:text-[#6F7680] focus:border-[#18C37E]/40",
        props.className,
      )}
    />
  );
}

export function BarberLineTabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T;
  items: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-xl border border-[#181C22] bg-[#0A0C0F] p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "min-h-9 rounded-lg px-4 text-sm font-semibold transition",
            value === item.value ? "bg-[#1A1F28] text-[#F0F4F8]" : "text-[#4A5260] hover:text-[#8A9299]",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function BarberLineDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 cursor-default" />
      <aside className="relative z-10 flex h-full w-full max-w-[420px] flex-col overflow-y-auto border-l border-[#1E2227] bg-[#0B0D0F] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#1E2227] px-5 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-[#F0F4F8]">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-[#4A5260]">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] text-[#8A9299] hover:bg-white/[0.05]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 p-5">{children}</div>
      </aside>
    </div>
  );
}

export function BarberLineStatus({ label, tone = "neutral" }: { label: string; tone?: "success" | "warning" | "neutral" | "danger" }) {
  const tones = {
    success: "border-[#18C37E]/25 bg-[#18C37E]/10 text-[#18C37E]",
    warning: "border-amber-800/25 bg-amber-950/20 text-amber-300",
    danger: "border-red-800/25 bg-red-950/20 text-red-300",
    neutral: "border-[#252A30] bg-white/[0.04] text-[#A4AAB3]",
  };
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold", tones[tone])}>{label}</span>;
}
