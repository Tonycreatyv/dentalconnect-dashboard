// src/components/BottomNav.tsx
import { NavLink } from "react-router-dom";
import {
  MessageSquareText,
  Users,
  Calendar,
  LayoutDashboard,
  Settings,
} from "lucide-react";

const items = [
  { to: "/overview", label: "Home", icon: LayoutDashboard },
  { to: "/conversations", label: "Inbox", icon: MessageSquareText },
  { to: "/appointments", label: "Agenda", icon: Calendar },
  { to: "/patients", label: "Leads", icon: Users },
  { to: "/settings", label: "Ajustes", icon: Settings },
];

export default function BottomNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/60 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-3xl items-center justify-around px-2 py-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                [
                  "flex w-full flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white",
                ].join(" ")
              }
            >
              <Icon size={18} />
              {it.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
