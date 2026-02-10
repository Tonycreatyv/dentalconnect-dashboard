import { useMemo } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { useActivity } from "../context/ActivityContext";

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ActivityDock() {
  const { events, open, setOpen, clear } = useActivity();

  const last = events[0];
  const hasEvents = events.length > 0;

  const headerText = useMemo(() => {
    if (!hasEvents) return "Sin actividad reciente";
    return last?.title ?? "Actividad";
  }, [hasEvents, last]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Collapsed pill */}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 shadow-lg backdrop-blur hover:bg-slate-950"
        >
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="max-w-[220px] truncate">{headerText}</span>
          <ChevronUp className="h-4 w-4 opacity-70 group-hover:opacity-100" />
        </button>
      ) : (
        <div className="w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 shadow-2xl backdrop-blur">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Activity className="h-4 w-4 text-slate-300" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-slate-100">Activity</div>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <span className="relative inline-flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-35" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    Live
                  </span>
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  {hasEvents ? `${events.length} eventos` : "Esperando eventos…"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clear}
                className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-slate-300 hover:bg-slate-950/70"
                title="Limpiar"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-slate-300 hover:bg-slate-950/70"
                title="Colapsar"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[280px] overflow-auto px-2 py-2">
            {!hasEvents ? (
              <div className="px-2 py-6 text-center text-xs text-slate-400">
                Todavía no hay eventos. Cuando entren mensajes o se envíen respuestas, aparecerán aquí.
              </div>
            ) : (
              <div className="space-y-2">
                {events.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        {e.level === "success" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                        ) : e.level === "warn" ? (
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
                        ) : e.level === "error" ? (
                          <XCircle className="mt-0.5 h-4 w-4 text-rose-300" />
                        ) : (
                          <Activity className="mt-0.5 h-4 w-4 text-slate-300" />
                        )}

                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-slate-100">
                            {e.title}
                          </div>
                          {e.detail ? (
                            <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">
                              {e.detail}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="shrink-0 text-[11px] text-slate-500">
                        {fmtTime(e.ts)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
            Tip: esto muestra acciones del sistema (inbox, envíos, errores). No afecta performance.
          </div>
        </div>
      )}
    </div>
  );
}
