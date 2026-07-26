import { NavLink, Outlet } from "react-router-dom";
import { Home, Inbox, MessageCircle, MoreHorizontal, ShoppingBag } from "lucide-react";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

export default function ReferralShell() {
  const { loading, error, features } = useReferralOrganization();
  if (loading) return <main className="min-h-screen bg-[#071018] p-8 text-white">Cargando Referral Hub…</main>;
  if (error) return <main className="min-h-screen bg-[#071018] p-8 text-red-200">{error}</main>;
  const links = [
    ["/", "Inicio", Home],
    ...(features.lg_leads_enabled ? [["/leads", "Leads", Inbox] as const] : []),
    ["/messages", "Mensajes", MessageCircle],
    ...(features.lg_grocery_orders_enabled ? [["/orders", "Pedidos", ShoppingBag] as const] : []),
    ["/more", "Más", MoreHorizontal],
  ] as const;
  return <div className="min-h-screen bg-[#071018] pb-20"><Outlet /><nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl justify-around border-t border-white/10 bg-[#0b151e]/95 px-2 py-2 backdrop-blur">{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `flex min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-1 text-[10px] font-bold ${isActive ? "text-[#25D366]" : "text-white/45"}`}><Icon className="h-5 w-5"/>{label}</NavLink>)}</nav></div>;
}
