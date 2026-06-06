// src/components/BottomNav.tsx
import {
  MessageSquareText,
  CalendarDays,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import { MobileBottomTabBar } from "./mobile/MobilePrimitives";

const items = [
  { to: "/hoy", label: "Hoy", icon: LayoutDashboard },
  { to: "/inbox", label: "Inbox", icon: MessageSquareText },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/leads", label: "Clientes", icon: Users },
  { to: "/settings", label: "Ajustes", icon: Settings },
];

export default function BottomNav() {
  return <MobileBottomTabBar items={items} />;
}
