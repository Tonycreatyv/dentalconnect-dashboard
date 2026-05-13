// src/components/Topbar.tsx
import { LogOut, Menu } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useClinic } from "../context/ClinicContext";

const SELECTED_ORG_STORAGE_KEY = "selected_organization_id";
const SELECTED_BUSINESS_TYPE_STORAGE_KEY = "selected_business_type";

const DEV_ORG_OPTIONS = [
  { label: "Dental Demo", organizationId: "clinic-demo", businessType: "dental" },
  { label: "Creatyv Product", organizationId: "creatyv-product", businessType: "dental" },
  { label: "Barbería Demo", organizationId: "barber-demo", businessType: "barbershop" },
] as const;

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
  const { clinic, activeOrgId } = useClinic();
  const clinicName = clinic?.name ?? "Clínica";
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SELECTED_ORG_STORAGE_KEY) ?? "";
      if (stored) {
        setSelectedOrgId(stored);
        return;
      }
    } catch {
      // ignore
    }
    setSelectedOrgId(activeOrgId ?? "");
  }, [activeOrgId]);

  const viewingLabel = useMemo(() => {
    const org = selectedOrgId || activeOrgId || "";
    const match = DEV_ORG_OPTIONS.find((opt) => opt.organizationId === org);
    return match?.label ?? clinicName;
  }, [selectedOrgId, activeOrgId, clinicName]);

  function handleDevOrgChange(nextOrgId: string) {
    const option = DEV_ORG_OPTIONS.find((opt) => opt.organizationId === nextOrgId);
    setSelectedOrgId(nextOrgId);
    try {
      localStorage.setItem(SELECTED_ORG_STORAGE_KEY, nextOrgId);
      localStorage.setItem(
        SELECTED_BUSINESS_TYPE_STORAGE_KEY,
        option?.businessType ?? "dental",
      );
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event("dev-org-changed"));
  }

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
          <div className="mt-1 text-xs font-medium text-emerald-300">Viewing: {viewingLabel}</div>
          <div className="mt-1 truncate text-sm text-white/70">
            Resumen operativo y acceso rápido a mensajes, citas y follow-ups.
          </div>
        </div>

        {import.meta.env.DEV ? (
          <label className="ml-auto min-w-[260px]">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-white/50">Dev Organization</span>
            <select
              value={selectedOrgId || activeOrgId || DEV_ORG_OPTIONS[0].organizationId}
              onChange={(e) => handleDevOrgChange(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none"
            >
              {DEV_ORG_OPTIONS.map((opt) => (
                <option key={opt.organizationId} value={opt.organizationId}>
                  {opt.label} / {opt.organizationId} / {opt.businessType}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="button"
          className="dc-btn-secondary disabled:opacity-60"
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
