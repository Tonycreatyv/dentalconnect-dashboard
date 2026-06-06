import { Clock3, MessageCircle, UserRound } from "lucide-react";
import { cn } from "../lib/cn";

const statusStyles: Record<string, { label: string; className: string; dot: string }> = {
  confirmed: { label: "Confirmada", className: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200", dot: "bg-emerald-300" },
  pending: { label: "Pendiente", className: "border-amber-300/25 bg-amber-400/10 text-amber-200", dot: "bg-amber-300" },
  cancelled: { label: "Cancelada", className: "border-rose-300/25 bg-rose-400/10 text-rose-200", dot: "bg-rose-300" },
  completed: { label: "Atendida", className: "border-sky-300/25 bg-sky-400/10 text-sky-200", dot: "bg-sky-300" },
};

function normalizeStatus(status?: string | null) {
  const key = String(status ?? "pending").toLowerCase();
  if (key === "booked") return "confirmed";
  if (key === "canceled") return "cancelled";
  if (key === "done" || key === "attended") return "completed";
  return statusStyles[key] ? key : "pending";
}

export function AppointmentCard({
  time,
  client,
  service,
  provider,
  status,
  accentClass = "bg-[#C97738]",
  compact = false,
  onMessage,
  onClick,
}: {
  time: string;
  client: string;
  service: string;
  provider: string;
  status?: string | null;
  accentClass?: string;
  compact?: boolean;
  onMessage?: () => void;
  onClick?: () => void;
}) {
  const statusKey = normalizeStatus(status);
  const style = statusStyles[statusKey];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.055] text-left shadow-[0_10px_28px_rgba(0,0,0,0.18)] transition hover:bg-white/[0.08]",
        compact ? "p-3" : "p-4",
      )}
    >
      <span className={cn("absolute inset-y-3 left-0 w-1 rounded-r-full", accentClass)} />
      <div className="flex min-w-0 items-start gap-3 pl-2">
        <div className="shrink-0 rounded-2xl bg-black/25 px-3 py-2 text-center">
          <div className="text-xs text-white/45">Hora</div>
          <div className="text-sm font-black text-white">{time}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="truncate text-sm font-bold text-white/95">{client}</div>
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", style.className)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
              {style.label}
            </span>
          </div>
          <div className="text-safe mt-1 text-sm text-white/70">{service}</div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-white/50">
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{provider}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              {time}
            </span>
          </div>
        </div>
        {onMessage ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onMessage();
            }}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <MessageCircle className="h-4 w-4" />
          </span>
        ) : null}
      </div>
    </button>
  );
}
