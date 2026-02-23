import { NavLink } from "react-router-dom";
import { LayoutDashboard, Inbox, CalendarDays, Users, Settings, Sparkles } from "lucide-react";
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
            ? "bg-blue-500/10 text-blue-400"
            : "text-white/70 hover:text-white hover:bg-white/5",
        ].join(" ")
      }
    >
      <Icon className="h-4 w-4 opacity-90" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { clinic } = useClinic();

  return (
    <aside className="rounded-3xl border border-white/10 bg-[#0F172A] p-4 text-white">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <BrandMark clinicName={clinic?.name ?? "Clínica"} />
      </div>

      <div className="mt-4 grid gap-2">
        <NavItem to="/overview" icon={LayoutDashboard} label="Overview" onNavigate={onNavigate} />
        <NavItem to="/inbox" icon={Inbox} label="Inbox" onNavigate={onNavigate} />
        <NavItem to="/agenda" icon={CalendarDays} label="Agenda" onNavigate={onNavigate} />
        <NavItem to="/marketing" icon={Sparkles} label="Marketing IA" onNavigate={onNavigate} />
        <NavItem to="/patients" icon={Users} label="Patients" onNavigate={onNavigate} />
        <NavItem to="/settings" icon={Settings} label="Settings" onNavigate={onNavigate} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs font-semibold text-white">Tip de hoy</div>
        <div className="mt-1 text-xs text-white/70">
          Confirmá citas del día con 1 click y evitá no-shows.
        </div>
      </div>
    </aside>
  );
}
