import { NavLink } from "react-router-dom";
import { LayoutDashboard, Inbox, CalendarDays, Users, Settings, CreditCard, Shield } from "lucide-react";
import { useClinic } from "../context/ClinicContext";
import { resolveFrontendBusinessType, resolveFrontendOrgName, useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";
import { MobileStatusPill } from "./mobile/MobilePrimitives";

function fallbackOrgLabel(organizationId: string): string {
  if (organizationId === "barber-demo") return "Barbería Premium 504";
  if (organizationId === "barber-demo-wimaeil") return "Barbería WIMAEIL";
  if (organizationId === "clinic-demo") return "Dental Demo";
  if (organizationId === "creatyv-product") return "Creatyv Product";
  if (organizationId === "testing-mxp0snq") return "Testing Barber Demo";
  if (organizationId === "testing-mnxp0snq") return "Testing Barber Demo";
  if (organizationId === "org-359ba3c4") return "Org 359 Test";
  if (organizationId === "irvin-mazariegos-clinic") return "Irvin Mazariegos Clinic";
  return organizationId;
}

function orgProductLabel(organizationId: string, businessType?: string | null): string {
  return businessType === "barbershop" || organizationId.startsWith("barber-") ? "BarberLine" : "DentalConnect";
}

function isDevOrg(organizationId: string, currentBusinessType: "dental" | "barbershop"): boolean {
  if (["testing-mxp0snq", "testing-mnxp0snq", "org-359ba3c4", "irvin-mazariegos-clinic", "creatyv-product"].includes(organizationId)) {
    return true;
  }
  return organizationId === "clinic-demo" && currentBusinessType === "barbershop";
}

function NavItem({
  to,
  icon: Icon,
  label,
  onNavigate,
}: {
  to: string;
  icon: any;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          "flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition",
          isActive
            ? "bg-[#25D366]/12 text-[#25D366]"
            : "text-[#9CAAB8] hover:bg-[#162838] hover:text-[#F8FAFC] lg:text-white/72 lg:hover:bg-white/5 lg:hover:text-white/92",
        ].join(" ")
      }
    >
      <Icon className="h-4 w-4 shrink-0 opacity-90" />
      <span className="min-w-0 truncate">{label}</span>
    </NavLink>
  );
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin, availableOrgs, activeOrgId, setActiveOrgId } = useClinic();
  const { resolvedOrgId, resolvedBusinessType, resolvedOrgName } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);

  const isBarbershop = resolvedBusinessType === "barbershop";
  const shopName = resolvedOrgName ?? fallbackOrgLabel(resolvedOrgId ?? activeOrgId ?? "");
  const orgOptions = availableOrgs.map((org) => {
    const organizationId = String(org.organization_id ?? "").trim();
    const businessType = org.business_type === "barbershop" ? "barbershop" : resolveFrontendBusinessType(organizationId);
    return {
      ...org,
      organization_id: organizationId,
      business_type: businessType,
      name: resolveFrontendOrgName(organizationId, businessType, org.name || fallbackOrgLabel(organizationId)),
    };
  });
  const operatorOrgOptions = orgOptions.filter((org) => !isDevOrg(org.organization_id, resolvedBusinessType));
  const devOrgOptions = orgOptions.filter((org) => isDevOrg(org.organization_id, resolvedBusinessType));

  return (
    <aside className="h-full overflow-y-auto rounded-none border-r border-[#25384A] bg-[#0B1620] p-4 text-[#F8FAFC] shadow-none lg:h-auto lg:overflow-hidden lg:rounded-3xl lg:border lg:border-white/10 lg:bg-[#0B0D12] lg:text-white lg:shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div className="rounded-3xl border border-[#25384A] bg-[#111F2B] p-4 lg:border-white/10 lg:bg-white/5">
        <div className="min-w-0">
          <div className="truncate text-lg font-black tracking-[-0.03em]">{shopName || vertical.organizationLabel}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-[#9CAAB8]">{isBarbershop ? "Operación de barbería" : vertical.productName}</span>
            <MobileStatusPill tone="success">Bot activo</MobileStatusPill>
          </div>
        </div>
      </div>

      {/* ADMIN ONLY: Selector de organización */}
      {isAdmin && availableOrgs.length > 1 && (
        <div className="mt-3 rounded-2xl border border-[#25384A] bg-[#111F2B] p-3 lg:border-amber-500/20 lg:bg-amber-500/5">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-amber-400">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="truncate">Admin Mode</span>
          </div>
          <select
            value={resolvedOrgId || activeOrgId || ""}
            onChange={(e) => setActiveOrgId(e.target.value)}
            className="mt-2 w-full truncate rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none"
          >
            {operatorOrgOptions.length > 0 ? (
              <optgroup label="Demos activos">
                {operatorOrgOptions.map((org) => (
                  <option key={org.organization_id} value={org.organization_id}>
                    {org.name || fallbackOrgLabel(org.organization_id)} · {orgProductLabel(org.organization_id, org.business_type)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {devOrgOptions.length > 0 ? (
              <optgroup label="Admin / Dev">
                {devOrgOptions.map((org) => (
                  <option key={org.organization_id} value={org.organization_id}>
                    {org.name || fallbackOrgLabel(org.organization_id)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
      )}

      <div className="mt-4 grid gap-1.5">
        <NavItem to="/hoy" icon={LayoutDashboard} label="Hoy" onNavigate={onNavigate} />
        <NavItem to="/inbox" icon={Inbox} label="Inbox" onNavigate={onNavigate} />
        <NavItem to="/agenda" icon={CalendarDays} label="Agenda" onNavigate={onNavigate} />
        <NavItem to="/leads" icon={Users} label={isBarbershop ? "Clientes" : vertical.customersLabel} onNavigate={onNavigate} />
        <NavItem to="/settings" icon={Settings} label="Ajustes" onNavigate={onNavigate} />
        {isAdmin ? <NavItem to="/billing" icon={CreditCard} label="Billing" onNavigate={onNavigate} /> : null}
      </div>

      <div className="mt-4 hidden rounded-2xl border border-white/10 bg-white/5 p-3 lg:block">
        <div className="text-xs font-semibold text-white/95">Tip de hoy</div>
        <div className="mt-1 text-xs text-white/70">
          Confirma citas del día con 1 click y evita no-shows de {vertical.customersLabel.toLowerCase()}.
        </div>
      </div>
    </aside>
  );
}
