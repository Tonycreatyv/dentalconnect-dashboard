// src/components/Topbar.tsx
import { LogOut, Menu } from "lucide-react";
import { useClinic } from "../context/ClinicContext";

export function Topbar({
  onLogout,
  onMenu,
  title,
}: {
  onLogout: () => void;
  onMenu?: () => void;
  title?: string;
}) {
  const { clinic } = useClinic();
  const clinicName = clinic?.name ?? "Clínica";

  return (
    <div className="rounded-3xl border border-[#E5E7EB] bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <button
          type="button"
          onClick={onMenu}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E5E7EB] bg-white text-slate-700 hover:bg-[#F4F5F7]"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-sm font-semibold text-slate-900 truncate">
          {title ?? "Panel"}
        </div>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E5E7EB] bg-white text-slate-700 hover:bg-[#F4F5F7]"
          onClick={onLogout}
          aria-label="Salir"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      <div className="hidden lg:flex lg:items-center lg:gap-3">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.22em] uppercase text-slate-500">{clinicName}</div>
          <div className="mt-1 truncate text-sm text-slate-700">
            Resumen operativo y acceso rápido a mensajes, citas y follow-ups.
          </div>
        </div>

        <button
          type="button"
          className="ml-auto inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-[#F4F5F7]"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          Salir
        </button>
      </div>
    </div>
  );
}
