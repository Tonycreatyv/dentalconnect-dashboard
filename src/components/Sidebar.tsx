import { NavLink } from "react-router-dom";
import { LayoutDashboard, Inbox, CalendarDays, Users, Settings, Sparkles, CreditCard, UserRound, Shield } from "lucide-react";
import BrandMark from "./BrandMark";
import { useClinic } from "../context/ClinicContext";

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
          "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition",
          isActive
            ? "bg-[#0894C1]/12 text-[#59E0B8]"
            : "text-white/72 hover:text-white/92 hover:bg-white/5",
        ].join(" ")
      }
    >
      <Icon className="h-4 w-4 opacity-90" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { clinic, isAdmin, availableOrgs, activeOrgId, setActiveOrgId } = useClinic();

  return (
    <aside className="rounded-3xl border border-white/10 bg-[#0B0D12] p-4 text-white">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <BrandMark clinicName={clinic?.name ?? "Clínica"} />
      </div>

      {/* ADMIN ONLY: Selector de organización */}
      {isAdmin && availableOrgs.length > 1 && (
        <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            <Shield className="h-3 w-3" />
            <span>Admin Mode</span>
          </div>
          <select
            value={activeOrgId ?? ""}
            onChange={(e) => setActiveOrgId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none"
          >
            {availableOrgs.map((org) => (
              <option key={org.organization_id} value={org.organization_id}>
                {org.organization_id}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4 grid gap-2">
        <NavItem to="/hoy" icon={LayoutDashboard} label="Hoy" onNavigate={onNavigate} />
        <NavItem to="/inbox" icon={Inbox} label="Inbox" onNavigate={onNavigate} />
        <NavItem to="/leads" icon={Users} label="Leads" onNavigate={onNavigate} />
        <NavItem to="/agenda" icon={CalendarDays} label="Agenda" onNavigate={onNavigate} />
        {/* <NavItem to="/marketing" icon={Sparkles} label="Marketing IA" onNavigate={onNavigate} /> */}
        <NavItem to="/patients" icon={UserRound} label="Patients" onNavigate={onNavigate} />
        <NavItem to="/billing" icon={CreditCard} label="Billing" onNavigate={onNavigate} />
        <NavItem to="/settings" icon={Settings} label="Settings" onNavigate={onNavigate} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs font-semibold text-white/95">Tip de hoy</div>
        <div className="mt-1 text-xs text-white/70">
          Confirmá citas del día con 1 click y evitá no-shows.
        </div>
      </div>
    </aside>
  );
}