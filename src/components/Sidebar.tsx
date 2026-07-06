import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Inbox, CalendarDays, Users, Settings, CreditCard, Shield, Scissors, Clock, LogOut, Handshake } from "lucide-react";
import { useClinic } from "../context/ClinicContext";
import { useAuth } from "../context/AuthContext";
import { resolveFrontendBusinessType, resolveFrontendOrgName, useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";
import { MobileStatusPill } from "./mobile/MobilePrimitives";

function fallbackOrgLabel(organizationId: string): string {
  if (organizationId === "barber-demo") return "BarberLine";
  if (organizationId === "barber-demo-wimaeil") return "Barbería WIMAEIL";
  if (organizationId === "insurance-demo") return "Luis Gabriel Referral Hub";
  if (organizationId === "clinic-demo") return "Dental Demo";
  if (organizationId === "creatyv-product") return "Creatyv Product";
  if (organizationId === "testing-mxp0snq") return "Testing Barber Demo";
  if (organizationId === "testing-mnxp0snq") return "Testing Barber Demo";
  if (organizationId === "org-359ba3c4") return "Org 359 Test";
  if (organizationId === "irvin-mazariegos-clinic") return "Irvin Mazariegos Clinic";
  return organizationId;
}

function orgProductLabel(organizationId: string, businessType?: string | null): string {
  if (businessType === "referral_hub" || organizationId === "insurance-demo") return "Referral Hub";
  return businessType === "barbershop" || organizationId.startsWith("barber-") ? "BarberLine" : "DentalConnect";
}

function isDevOrg(organizationId: string, currentBusinessType: string): boolean {
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
  active,
}: {
  to: string;
  icon: any;
  label: string;
  onNavigate?: () => void;
  active?: boolean;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          "flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition",
          (active ?? isActive)
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
  const location = useLocation();
  const { isAdmin, availableOrgs, activeOrgId, setActiveOrgId } = useClinic();
  const { signOut, user } = useAuth();
  const { resolvedOrgId, resolvedBusinessType, resolvedOrgName } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);

  const isBarbershop = resolvedBusinessType === "barbershop";
  const isReferralHub = resolvedBusinessType === "referral_hub";
  const shopName = resolvedOrgName ?? fallbackOrgLabel(resolvedOrgId ?? activeOrgId ?? "");
  const orgOptions = availableOrgs.map((org) => {
    const organizationId = String(org.organization_id ?? "").trim();
    const businessType = org.business_type ?? resolveFrontendBusinessType(organizationId);
    return {
      ...org,
      organization_id: organizationId,
      business_type: businessType,
      name: resolveFrontendOrgName(organizationId, businessType, org.name || fallbackOrgLabel(organizationId)),
    };
  });
  const operatorOrgOptions = orgOptions.filter((org) => !isDevOrg(org.organization_id, resolvedBusinessType));
  const devOrgOptions = orgOptions.filter((org) => isDevOrg(org.organization_id, resolvedBusinessType));
  const currentPathWithSearch = `${location.pathname}${location.search}`;
  const isActivePath = (target: string) => currentPathWithSearch === target;
  const isActivePlainPath = (target: string) => location.pathname === target && !location.search;

  return (
    <aside className={[
      "h-full overflow-y-auto rounded-none border-r p-4 text-[#F8FAFC] shadow-none lg:h-auto lg:overflow-hidden lg:rounded-3xl lg:border lg:text-white",
      isBarbershop
        ? "border-[#1E2227] bg-[#07090B] lg:border-[#1E2227] lg:bg-[#0B0D0F] lg:shadow-[0_20px_60px_rgba(0,0,0,0.34)]"
        : "border-[#25384A] bg-[#0B1620] lg:border-white/10 lg:bg-[#0B0D12] lg:shadow-[0_20px_60px_rgba(0,0,0,0.28)]",
    ].join(" ")}>
      <div className={[
        "rounded-3xl border p-4",
        isBarbershop ? "border-[#1E2227] bg-[#0E1014]" : "border-[#25384A] bg-[#111F2B] lg:border-white/10 lg:bg-white/5",
      ].join(" ")}>
        <div className="min-w-0">
          {isBarbershop ? (
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#18C37E]/20 bg-[#18C37E]/12">
                <Scissors className="h-4 w-4 text-[#18C37E]" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black tracking-tight text-[#F5F7FA]">BarberLine</div>
                <div className="text-[10px] text-[#6F7680]">by Creatyv</div>
              </div>
            </div>
          ) : null}
          <div className="truncate text-lg font-black tracking-[-0.03em]">{shopName || vertical.organizationLabel}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-[#9CAAB8]">{isBarbershop ? "Operación de barbería" : vertical.productName}</span>
            <MobileStatusPill tone="success">Bot activo</MobileStatusPill>
          </div>
        </div>
      </div>

      {/* ADMIN ONLY: Selector de organización */}
      {isAdmin && availableOrgs.length > 1 && (
        <div className="mt-3 rounded-2xl border border-[#25384A] bg-[#111F2B]/80 p-3 lg:border-white/10 lg:bg-white/[0.035]">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#9CAAB8]">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="truncate">{isBarbershop ? "Cambiar barbería" : "Admin Mode"}</span>
          </div>
          <select
            value={resolvedOrgId || activeOrgId || ""}
            onChange={(e) => setActiveOrgId(e.target.value)}
            className="mt-2 w-full truncate rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none"
          >
            {operatorOrgOptions.length > 0 ? (
              <optgroup label={isBarbershop ? "Barberías" : "Demos activos"}>
                {operatorOrgOptions.map((org) => (
                  <option key={org.organization_id} value={org.organization_id}>
                    {org.name || fallbackOrgLabel(org.organization_id)} · {orgProductLabel(org.organization_id, org.business_type)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {devOrgOptions.length > 0 ? (
              <optgroup label={isBarbershop ? "Otras cuentas" : "Admin / Dev"}>
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
        <NavItem to="/hoy" icon={LayoutDashboard} label="Hoy" active={isActivePlainPath("/hoy")} onNavigate={onNavigate} />
        {isReferralHub ? (
          <NavItem to="/referral-hub" icon={Handshake} label="Referral Hub" active={isActivePlainPath("/referral-hub")} onNavigate={onNavigate} />
        ) : null}
        <NavItem to="/agenda" icon={CalendarDays} label={isBarbershop ? "Citas" : vertical.agendaTitle} active={isActivePlainPath("/agenda")} onNavigate={onNavigate} />
        <NavItem to="/leads" icon={Users} label={isBarbershop ? "Clientes" : vertical.customersLabel} active={isActivePlainPath("/leads")} onNavigate={onNavigate} />
        <NavItem to="/inbox" icon={Inbox} label="Inbox" active={location.pathname.startsWith("/inbox")} onNavigate={onNavigate} />
        {isBarbershop ? (
          <>
            <NavItem to="/settings?tab=servicios" icon={Scissors} label={vertical.servicesLabel} active={isActivePath("/settings?tab=servicios")} onNavigate={onNavigate} />
            <NavItem to="/settings?tab=equipo" icon={Users} label={vertical.providersLabel} active={isActivePath("/settings?tab=equipo")} onNavigate={onNavigate} />
            <NavItem to="/settings?tab=horario" icon={Clock} label={vertical.scheduleLabel} active={isActivePath("/settings?tab=horario")} onNavigate={onNavigate} />
          </>
        ) : null}
        <NavItem to="/settings" icon={Settings} label={isBarbershop ? "Configuración" : vertical.settingsLabel} active={isBarbershop ? isActivePlainPath("/settings") : location.pathname === "/settings"} onNavigate={onNavigate} />
        {isAdmin ? <NavItem to="/billing" icon={CreditCard} label={isBarbershop ? "Plan" : "Billing"} active={isActivePlainPath("/billing")} onNavigate={onNavigate} /> : null}
      </div>

      {isBarbershop ? (
        <div className="mt-4 border-t border-[#1E2227] pt-4">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-sm font-semibold text-[#6F7680] transition hover:border-rose-400/10 hover:bg-rose-500/[0.06] hover:text-rose-300"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">Salir</span>
          </button>
          <div className="mt-2 flex min-w-0 items-center gap-3 rounded-2xl px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#18C37E]/20 bg-[#18C37E]/15 text-xs font-black text-[#18C37E]">
              {(shopName || "BB").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#F5F7FA]">{shopName || "BarberLine"}</p>
              <p className="truncate text-[10px] text-[#6F7680]">{user?.email ?? "panel@barberline.com"}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 hidden rounded-2xl border border-white/10 bg-white/5 p-3 lg:block">
        <div className="text-xs font-semibold text-white/95">Tip de hoy</div>
        <div className="mt-1 text-xs text-white/70">
          Confirma citas del día con 1 click y evita no-shows de {vertical.customersLabel.toLowerCase()}.
        </div>
      </div>
    </aside>
  );
}
