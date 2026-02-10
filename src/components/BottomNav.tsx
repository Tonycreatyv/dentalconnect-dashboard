import { NavLink } from "react-router-dom";
import {
  MessageSquareText,
  Users,
  Calendar,
  LineChart,
  Settings,
} from "lucide-react";

const items = [
  { to: "/conversations", label: "Inbox", icon: MessageSquareText },
  { to: "/patients", label: "Leads", icon: Users },
  { to: "/appointments", label: "Citas", icon: Calendar },
  { to: "/", label: "Panel", icon: LineChart },
  { to: "/settings", label: "Ajustes", icon: Settings },
];

export const BottomNav = () => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-3">
        <div className="grid grid-cols-5 gap-1 py-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                [
                  "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] tracking-[0.16em] uppercase transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/55 hover:text-white hover:bg-white/5",
                ].join(" ")
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="leading-none">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
};
