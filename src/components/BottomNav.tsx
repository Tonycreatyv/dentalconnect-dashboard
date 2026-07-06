// src/components/BottomNav.tsx
import {
  MessageSquareText,
  CalendarDays,
  LayoutDashboard,
  Settings,
  Users,
  Handshake,
} from "lucide-react";
import { MobileBottomTabBar } from "./mobile/MobilePrimitives";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";

export default function BottomNav() {
  const { resolvedBusinessType } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);
  const isBarbershop = resolvedBusinessType === "barbershop";
  const isReferralHub = resolvedBusinessType === "referral_hub";
  const items = isReferralHub ? [
    { to: "/referral-hub", label: "Hub", icon: Handshake },
    { to: "/leads", label: "Leads", icon: Users },
    { to: "/inbox", label: "Inbox", icon: MessageSquareText },
    { to: "/settings", label: "Ajustes", icon: Settings },
    { to: "/hoy", label: "Hoy", icon: LayoutDashboard },
  ] : [
    { to: "/hoy", label: "Hoy", icon: LayoutDashboard },
    { to: "/agenda", label: isBarbershop ? "Citas" : vertical.agendaTitle, icon: CalendarDays },
    { to: "/leads", label: vertical.customersLabel, icon: Users },
    { to: "/inbox", label: "Inbox", icon: MessageSquareText },
    { to: "/settings", label: isBarbershop ? "Configuración" : vertical.settingsLabel, icon: Settings },
  ];
  return <MobileBottomTabBar items={items} />;
}
