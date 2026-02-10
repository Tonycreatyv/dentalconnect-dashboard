import { NavLink } from "react-router-dom";
import {
  Calendar,
  LineChart,
  ClipboardList,
  MessageSquareText,
  Settings,
  Stethoscope,
  Users,
} from "lucide-react";
import { useClinic } from "../context/ClinicContext";

const navItems = [
  { to: "/", label: "Overview", icon: LineChart },
  { to: "/conversations", label: "Inbox", icon: MessageSquareText },
  { to: "/patients", label: "Leads", icon: Users },
  { to: "/appointments", label: "Citas", icon: Calendar },
  { to: "/analytics", label: "Analytics", icon: ClipboardList },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const Sidebar = () => {
  const { clinic } = useClinic();

  return (
    <aside className="h-screen w-72 border-r border-white/10 bg-slate-950/40 backdrop-blur px-5 py-6">
      {/* Brand block */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-subtle">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
            <Stethoscope className="h-5 w-5 text-teal-300" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-[0.22em] uppercase text-white">
              DentalConnect
            </p>
            <p className="text-[11px] tracking-[0.18em] uppercase text-white/50">
              Creatyv
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="text-[10px] tracking-[0.22em] uppercase text-white/55">
            Clínica activa
          </p>
          <p className="mt-1 text-sm font-medium text-white">
            {clinic?.name ?? "Clinic Demo"}
          </p>
          <p className="text-xs text-white/45">{clinic?.domain ?? "dental.creatyv.io"}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="mt-6 flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isActive
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5",
              ].join(" ")
            }
          >
            <item.icon className="h-4 w-4 text-white/70 group-hover:text-white" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer note */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/55">
        <p className="text-[10px] tracking-[0.22em] uppercase text-white/60">
          Messaging Automation
        </p>
        <p className="mt-2 leading-relaxed">
          Inbox estilo WhatsApp/Messenger, leads, citas y follow-ups — con plantillas editables por clínica.
        </p>
      </div>
    </aside>
  );
};
