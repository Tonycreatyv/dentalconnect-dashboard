// src/components/Topbar.tsx
import { LogOut, Menu } from "lucide-react";
import { useClinic } from "../context/ClinicContext";

export function Topbar({
  onLogout,
  onMenu,
  title,
  loading = false,
}: {
  onLogout: () => void;
  onMenu?: () => void;
  title?: string;
  loading?: boolean;
}) {
  const { clinic } = useClinic();
  const clinicName = clinic?.name ?? "Clínica";

  return (
    <div className="dc-card px-5 py-4">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        {onMenu ? (
          <button
            type="button"
            onClick={onMenu}
            className="dc-btn-secondary h-11 w-11 p-0 text-white/85"
            aria-label="Abrir menú"
            disabled={loading}
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : (
          <div className="h-11 w-11" />
        )}
        <div className="min-w-0 text-sm font-semibold text-white/95 truncate">
          {title ?? "Panel"}
        </div>
        <button
          type="button"
          className="dc-btn-secondary h-11 w-11 p-0 text-white/85 disabled:opacity-60"
          onClick={onLogout}
          aria-label="Salir"
          disabled={loading}
        >
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
          ) : (
            <LogOut className="h-5 w-5" />
          )}
        </button>
      </div>

      <div className="hidden lg:flex lg:items-center lg:gap-3">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.22em] uppercase text-white/50">{clinicName}</div>
          <div className="mt-1 truncate text-sm text-white/70">
            Resumen operativo y acceso rápido a mensajes, citas y follow-ups.
          </div>
        </div>

        <button
          type="button"
          className="dc-btn-secondary ml-auto disabled:opacity-60"
          onClick={onLogout}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              Saliendo…
            </>
          ) : (
            <>
              <LogOut className="h-4 w-4" />
              Salir
            </>
          )}
        </button>
      </div>
    </div>
  );
}
