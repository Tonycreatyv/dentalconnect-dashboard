import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

type Tone = "default" | "accent" | "success" | "warning" | "danger" | "muted";

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const toneClasses: Record<Tone, string> = {
  default: "border-[#25384A] bg-[#111F2B] text-[#F8FAFC]",
  accent: "border-[#25D366]/40 bg-[#25D366]/12 text-[#BDF8D1]",
  success: "border-[#22C55E]/35 bg-[#22C55E]/12 text-[#BDF8D1]",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  danger: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  muted: "border-[#25384A] bg-[#162838] text-[#9CAAB8]",
};

export function MobilePage({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mobile-operator-page", className)} {...props} />;
}

export function MobileAppHeader({
  title,
  eyebrow,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-h-[56px] min-w-0 items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9CAAB8]">{eyebrow}</div> : null}
        <h1 className="truncate text-[22px] font-black leading-tight tracking-[-0.03em] text-[#F8FAFC]">{title}</h1>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-[#9CAAB8]">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function MobileCard({ className, elevated = false, ...props }: HTMLAttributes<HTMLElement> & { elevated?: boolean }) {
  return <section className={cn(elevated ? "mobile-surface-elevated" : "mobile-surface", className)} {...props} />;
}

export function MobileHeader(props: Parameters<typeof MobileAppHeader>[0]) {
  return <MobileAppHeader {...props} />;
}

export function MobileStatusPill({ tone = "default", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("mobile-status-pill", toneClasses[tone], className)} {...props} />;
}

export function MobileChip({ active = false, tone = "accent", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tone?: Tone }) {
  return (
    <button
      type="button"
      className={cn("mobile-chip transition active:scale-[0.99]", active ? toneClasses[tone] : toneClasses.muted, className)}
      {...props}
    />
  );
}

export function MobileFilterChips({
  items,
  value,
  onChange,
  tone = "accent",
}: {
  items: Array<{ value: string; label: ReactNode }>;
  value: string;
  onChange: (value: string) => void;
  tone?: Tone;
}) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
      {items.map((item) => (
        <MobileChip key={item.value} active={value === item.value} tone={tone} onClick={() => onChange(item.value)}>
          {item.label}
        </MobileChip>
      ))}
    </div>
  );
}

export function MobileActionTile({ icon: Icon, label, detail, tone = "default", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; label: ReactNode; detail?: ReactNode; tone?: Tone }) {
  return (
    <button
      type="button"
      className={cn("min-h-[44px] min-w-0 rounded-2xl border px-3 py-2 text-left transition active:scale-[0.99]", toneClasses[tone], className)}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
        <span className="truncate text-xs font-black">{label}</span>
      </div>
      {detail ? <div className="mt-0.5 truncate text-[11px] text-[#9CAAB8]">{detail}</div> : null}
    </button>
  );
}

export function MobileActionButton({ tone = "default", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type="button" className={cn("mobile-action-button", toneClasses[tone], className)} {...props} />;
}

export function MobileAttentionRow({
  items,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; tone?: Tone; onClick?: () => void }>;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item, index) => {
        const Element = item.onClick ? "button" : "div";
        return (
          <Element
            key={index}
            onClick={item.onClick}
            className={cn("min-w-0 rounded-2xl border px-2.5 py-2.5 text-left transition", toneClasses[item.tone ?? "default"], item.onClick ? "active:scale-[0.99]" : null)}
          >
            <div className="truncate text-lg font-black text-[#F8FAFC]">{item.value}</div>
            <div className="truncate text-[11px] text-[#9CAAB8]">{item.label}</div>
          </Element>
        );
      })}
    </div>
  );
}

export function MobileStatTile(props: Parameters<typeof MobileAttentionRow>[0]["items"][number]) {
  const Element = props.onClick ? "button" : "div";
  return (
    <Element
      onClick={props.onClick}
      className={cn("min-w-0 rounded-2xl border px-2.5 py-2.5 text-left transition", toneClasses[props.tone ?? "default"], props.onClick ? "active:scale-[0.99]" : null)}
    >
      <div className="truncate text-lg font-black text-[#F8FAFC]">{props.value}</div>
      <div className="truncate text-[11px] text-[#9CAAB8]">{props.label}</div>
    </Element>
  );
}

export function MobileConversationRow({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("mobile-conversation-row", className)} {...props} />;
}

export function MobileAppointmentRow({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("mobile-appointment-row", className)} {...props} />;
}

export function MobileClientRow({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("mobile-client-row", className)} {...props} />;
}

export function MobileSettingsRow({ icon: Icon, title, detail, right, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; title: ReactNode; detail?: ReactNode; right?: ReactNode }) {
  return (
    <button type="button" className={cn("mobile-settings-row", className)} {...props}>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-[#25D366]" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-[#F8FAFC]">{title}</span>
        {detail ? <span className="mt-0.5 block truncate text-xs text-[#9CAAB8]">{detail}</span> : null}
      </span>
      {right ? <span className="shrink-0">{right}</span> : null}
    </button>
  );
}

export function MobileListRow({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <MobileAppointmentRow className={className} {...props} />;
}

export function MobileEmptyState({ icon: Icon, title, description, action }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#25384A] bg-[#111F2B] px-4 py-7 text-center">
      {Icon ? <Icon className="mx-auto mb-2 h-8 w-8 text-[#9CAAB8]/45" /> : null}
      <p className="text-sm font-bold text-[#F8FAFC]">{title}</p>
      {description ? <p className="mt-1 text-xs leading-relaxed text-[#9CAAB8]">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function MobileBottomSheet({ open, children, className }: HTMLAttributes<HTMLDivElement> & { open: boolean }) {
  if (!open) return null;
  return <div className={cn("mobile-bottom-sheet", className)}>{children}</div>;
}

export function MobileBottomTabs({ items }: { items: Array<{ to: string; label: string; icon: LucideIcon }> }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#25384A] bg-[#0B1620]/96 shadow-[0_-10px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1 px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 py-1.5 text-[10px] font-bold transition",
                  isActive ? "bg-[#25D366]/12 text-[#25D366]" : "text-[#9CAAB8] hover:bg-[#162838] hover:text-[#F8FAFC]",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="max-w-full truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileBottomTabBar(props: Parameters<typeof MobileBottomTabs>[0]) {
  return <MobileBottomTabs {...props} />;
}
