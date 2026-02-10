import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, CalendarDays, Send, X } from "lucide-react";

export function NotificationsDropdown({
  open,
  onClose,
  unread,
  apptsToday,
  outboxPending,
}: {
  open: boolean;
  onClose: () => void;
  unread: number;
  apptsToday: number;
  outboxPending: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    function onClick(e: MouseEvent) {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) onClose();
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  const total = unread + apptsToday + outboxPending;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-[340px] rounded-2xl border border-slate-800 bg-slate-950/95 p-3 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center justify-between px-1">
        <div className="text-sm font-semibold text-slate-100">Notificaciones</div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-slate-200 hover:bg-slate-950/70"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {total === 0 ? (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-sm text-slate-400">
          Sin notificaciones por ahora.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Link
            to="/conversations"
            onClick={onClose}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 hover:bg-slate-950/70"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-teal-300" />
              <div className="text-sm text-slate-200">Mensajes nuevos</div>
            </div>
            <div className="text-sm font-semibold text-slate-100">{unread}</div>
          </Link>

          <Link
            to="/appointments"
            onClick={onClose}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 hover:bg-slate-950/70"
          >
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-teal-300" />
              <div className="text-sm text-slate-200">Citas hoy</div>
            </div>
            <div className="text-sm font-semibold text-slate-100">{apptsToday}</div>
          </Link>

          <Link
            to="/analytics"
            onClick={onClose}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 hover:bg-slate-950/70"
          >
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-teal-300" />
              <div className="text-sm text-slate-200">Outbox pendiente</div>
            </div>
            <div className="text-sm font-semibold text-slate-100">{outboxPending}</div>
          </Link>
        </div>
      )}

      <div className="mt-3 px-1 text-[11px] text-slate-500">
        Tip: esto combina inbox, citas y outbox en un panel rápido.
      </div>
    </div>
  );
}
