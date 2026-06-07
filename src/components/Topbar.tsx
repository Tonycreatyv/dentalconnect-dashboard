// src/components/Topbar.tsx
import { LogOut, Menu } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useClinic } from "../context/ClinicContext";
import { resolveFrontendBusinessType, resolveFrontendOrgName, useActiveOrg } from "../hooks/useActiveOrg";
import { getDetectedVerticalConfig, getVerticalConfig } from "../config/verticalConfig";

const SELECTED_ORG_STORAGE_KEY = "selected_organization_id";
const SELECTED_BUSINESS_TYPE_STORAGE_KEY = "selected_business_type";

const DEV_ORG_OPTIONS = [
  { label: "Barbería WIMAEIL", organizationId: "barber-demo-wimaeil", businessType: "barbershop" },
  { label: "BarberLine", organizationId: "barber-demo", businessType: "barbershop" },
  { label: "Dental Demo", organizationId: "clinic-demo", businessType: "dental" },
  { label: "Creatyv Product", organizationId: "creatyv-product", businessType: "dental" },
  { label: "Testing Barber Demo", organizationId: "testing-mxp0snq", businessType: "barbershop" },
  { label: "Testing Barber Demo", organizationId: "testing-mnxp0snq", businessType: "barbershop" },
  { label: "Org 359 Test", organizationId: "org-359ba3c4", businessType: "dental" },
  { label: "Irvin Mazariegos Clinic", organizationId: "irvin-mazariegos-clinic", businessType: "dental" },
] as const;

function fallbackOrgLabel(organizationId: string): string {
  if (organizationId === "barber-demo") return "BarberLine";
  if (organizationId === "barber-demo-wimaeil") return "Barbería WIMAEIL";
  if (organizationId === "clinic-demo") return "Dental Demo";
  if (organizationId === "creatyv-product") return "Creatyv Product";
  if (organizationId === "testing-mxp0snq") return "Testing Barber Demo";
  if (organizationId === "testing-mnxp0snq") return "Testing Barber Demo";
  if (organizationId === "org-359ba3c4") return "Org 359 Test";
  if (organizationId === "irvin-mazariegos-clinic") return "Irvin Mazariegos Clinic";
  return organizationId;
}

function fallbackOrgBusinessType(organizationId: string): "dental" | "barbershop" {
  return resolveFrontendBusinessType(organizationId);
}

function isDevOrg(organizationId: string, currentBusinessType: "dental" | "barbershop"): boolean {
  if (["testing-mxp0snq", "testing-mnxp0snq", "org-359ba3c4", "irvin-mazariegos-clinic", "creatyv-product"].includes(organizationId)) {
    return true;
  }
  return organizationId === "clinic-demo" && currentBusinessType === "barbershop";
}

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
  const { activeOrgId, setActiveOrgId, isAdmin, availableOrgs } = useClinic();
  const { resolvedOrgId, resolvedBusinessType, resolvedOrgName } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);
  const detectedVertical = useMemo(() => getDetectedVerticalConfig(), []);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  useEffect(() => {
    setSelectedOrgId(resolvedOrgId ?? activeOrgId ?? "");
  }, [activeOrgId, resolvedOrgId]);

  const viewingLabel = useMemo(() => {
    const org = selectedOrgId || resolvedOrgId || activeOrgId || "";
    const match = DEV_ORG_OPTIONS.find((opt) => opt.organizationId === org);
    const available = availableOrgs.find((item) => item.organization_id === org);
    return resolveFrontendOrgName(
      org,
      resolvedBusinessType,
      resolvedOrgName || available?.name || match?.label || fallbackOrgLabel(org),
    );
  }, [selectedOrgId, resolvedOrgId, activeOrgId, resolvedOrgName, resolvedBusinessType, availableOrgs]);

  const orgOptions = useMemo(() => {
    const map = new Map<string, { label: string; organizationId: string; businessType: "dental" | "barbershop" }>();
    for (const opt of DEV_ORG_OPTIONS) {
      if (detectedVertical.businessType && opt.businessType !== detectedVertical.businessType) continue;
      map.set(opt.organizationId, opt);
    }
    for (const org of availableOrgs) {
      const organizationId = String(org.organization_id ?? "").trim();
      if (!organizationId) continue;
      const businessType = org.business_type === "barbershop" ? "barbershop" : fallbackOrgBusinessType(organizationId);
      if (detectedVertical.businessType && businessType !== detectedVertical.businessType) continue;
      map.set(organizationId, {
        organizationId,
        businessType,
        label: resolveFrontendOrgName(organizationId, businessType, org.name || fallbackOrgLabel(organizationId)),
      });
    }
    const active = selectedOrgId || resolvedOrgId || activeOrgId || "";
    const activeBusinessType = active ? fallbackOrgBusinessType(active) : null;
    if (active && !map.has(active) && (!detectedVertical.businessType || activeBusinessType === detectedVertical.businessType)) {
      map.set(active, {
        organizationId: active,
        businessType: resolvedBusinessType,
        label: resolvedOrgName || fallbackOrgLabel(active),
      });
    }
    return Array.from(map.values());
  }, [activeOrgId, availableOrgs, detectedVertical.businessType, resolvedBusinessType, resolvedOrgId, resolvedOrgName, selectedOrgId]);

  const operatorOrgOptions = useMemo(
    () => orgOptions.filter((org) => !isDevOrg(org.organizationId, resolvedBusinessType)),
    [orgOptions, resolvedBusinessType],
  );
  const devOrgOptions = useMemo(
    () => orgOptions.filter((org) => isDevOrg(org.organizationId, resolvedBusinessType)),
    [orgOptions, resolvedBusinessType],
  );

  const productLabel = vertical.verticalName.toUpperCase();
  const appLabel = vertical.brandName;
  const displayTitle = title || vertical.dashboardLabel;
  const subtitle = resolvedBusinessType === "barbershop"
    ? "Resumen operativo de citas, mensajes y disponibilidad de BarberLine."
    : "Resumen operativo y acceso rapido a mensajes, citas y follow-ups.";

  async function handleDevOrgChange(nextOrgId: string) {
    const option = orgOptions.find((opt) => opt.organizationId === nextOrgId);
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
    await setActiveOrgId(nextOrgId);
    window.dispatchEvent(new Event("dev-org-changed"));
  }

  return (
    <div className={[
      "overflow-hidden border-b px-4 py-2 backdrop-blur lg:px-5 lg:py-4",
      resolvedBusinessType === "barbershop"
        ? "border-[#1E2227] bg-[#0B0D0F]/95 lg:rounded-3xl lg:border lg:bg-[#0E1014]"
        : "border-[#25384A] bg-[#0B1620]/95 lg:ui-card lg:border-white/10 lg:bg-white/[0.055]",
    ].join(" ")}>
      <div className="flex items-center justify-between gap-3 lg:hidden">
        {onMenu ? (
          <button
            type="button"
            onClick={onMenu}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#25384A] bg-[#111F2B] text-[#F8FAFC]"
            aria-label="Abrir menú"
            disabled={loading}
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : (
          <div className="h-10 w-10 sm:h-11 sm:w-11" />
        )}
        <div className="min-w-0 truncate text-sm font-bold text-[#F8FAFC]">
          {displayTitle}
        </div>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[#25384A] bg-[#111F2B] text-[#F8FAFC] disabled:opacity-60"
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

      <div className="hidden min-w-0 lg:flex lg:items-center lg:gap-3">
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[10px] uppercase tracking-[0.22em] ${resolvedBusinessType === "barbershop" ? "text-[#18C37E]" : "text-white/50"}`}>{resolvedBusinessType === "barbershop" ? "BARBERÍA · BARBERLINE" : `${productLabel} · ${appLabel}`}</div>
          <div className="mt-1 truncate text-lg font-black tracking-[-0.03em] text-white">{displayTitle}</div>
          <div className={`mt-1 truncate text-xs font-medium ${resolvedBusinessType === "barbershop" ? "text-[#8A9299]" : "text-emerald-300"}`}>{resolvedBusinessType === "barbershop" ? viewingLabel : `Viewing: ${viewingLabel}`}</div>
          <div className="mt-1 truncate text-sm text-white/70">
            {subtitle}
          </div>
        </div>

        {import.meta.env.DEV && isAdmin ? (
          <label className="min-w-[240px] shrink-0">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-white/50">{resolvedBusinessType === "barbershop" ? "Cambiar barbería" : "Dev Organization"}</span>
            <select
              value={selectedOrgId || resolvedOrgId || activeOrgId || orgOptions[0]?.organizationId || DEV_ORG_OPTIONS[0].organizationId}
              onChange={(e) => void handleDevOrgChange(e.target.value)}
              className={resolvedBusinessType === "barbershop" ? "w-full truncate rounded-xl border border-white/[0.08] bg-[#05060A] px-3 py-2 text-sm text-[#E8ECF2] outline-none focus:border-[#18C37E]/35" : "w-full truncate rounded-xl border border-white/15 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none"}
            >
              {operatorOrgOptions.length > 0 ? (
                <optgroup label={resolvedBusinessType === "barbershop" ? "Barberías" : "Demos activos"}>
                  {operatorOrgOptions.map((opt) => (
                    <option key={opt.organizationId} value={opt.organizationId}>
                      {opt.label} · {opt.businessType === "barbershop" ? "BarberLine" : "DentalConnect"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {devOrgOptions.length > 0 ? (
                <optgroup label={resolvedBusinessType === "barbershop" ? "Otras cuentas" : "Admin / Dev"}>
                  {devOrgOptions.map((opt) => (
                    <option key={opt.organizationId} value={opt.organizationId}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
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
