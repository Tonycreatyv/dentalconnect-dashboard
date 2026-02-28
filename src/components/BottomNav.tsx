// src/components/BottomNav.tsx
import { NavLink } from "react-router-dom";
import {
  MessageSquareText,
  CalendarDays,
  LayoutDashboard,
  Settings,
  Sparkles,
  CreditCard,
} from "lucide-react";

const items = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/inbox", label: "Inbox", icon: MessageSquareText },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/marketing", label: "Marketing", icon: Sparkles },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function BottomNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#060A12]/90 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-3xl items-center justify-around px-2 py-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
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
                    ? "bg-white/[0.1] text-[#59E0B8]"
                    : "text-white/55 hover:bg-white/[0.08] hover:text-white/90",
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
