// src/components/BottomNav.tsx
import {
  MessageSquareText,
  CalendarDays,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import { MobileBottomTabBar } from "./mobile/MobilePrimitives";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";

export default function BottomNav() {
  const { resolvedBusinessType } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);
  const items = [
    { to: "/hoy", label: "Hoy", icon: LayoutDashboard },
    { to: "/agenda", label: vertical.agendaTitle, icon: CalendarDays },
    { to: "/leads", label: vertical.customersLabel, icon: Users },
    { to: "/inbox", label: "Inbox", icon: MessageSquareText },
    { to: "/settings", label: vertical.settingsLabel, icon: Settings },
  ];
  return <MobileBottomTabBar items={items} />;
}
