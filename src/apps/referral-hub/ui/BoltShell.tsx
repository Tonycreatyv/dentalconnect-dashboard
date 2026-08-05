import { Briefcase, Home, Inbox, Menu, MoreHorizontal, ShoppingBag, UsersRound, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

const primary = [
  { to: "/", label: "Inicio", icon: Home, end: true },
  { to: "/messages", label: "Inbox", icon: Inbox, end: false },
  { to: "/work", label: "Trabajo", icon: Briefcase, end: false },
  { to: "/orders", label: "Pedidos", icon: ShoppingBag, end: false },
  { to: "/network", label: "Red", icon: UsersRound, end: false },
  { to: "/more", label: "Más", icon: MoreHorizontal, end: false },
] as const;

export default function BoltShell() {
  const { loading, error, resolvedOrgName } = useReferralOrganization();
  const [open, setOpen] = useState(false);
  if (loading) return <main className="bolt-rh-loading">Cargando Referral Hub…</main>;
  if (error) return <main className="bolt-rh-loading is-error">{error}</main>;
  return <div className="bolt-rh-shell">
    <aside className={open ? "bolt-rh-sidebar is-open" : "bolt-rh-sidebar"}>
      <header><div className="bolt-rh-logo">LG</div><div><strong>Referral Hub</strong><span>{resolvedOrgName}</span></div><button onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></button></header>
      <nav aria-label="Navegación principal">{primary.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}</nav>
      <footer>Panel administrativo</footer>
    </aside>
    {open ? <button className="bolt-rh-scrim" onClick={() => setOpen(false)} aria-label="Cerrar menú" /> : null}
    <div className="bolt-rh-workspace"><header className="bolt-rh-topbar"><button onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button><strong>{resolvedOrgName}</strong></header><div className="bolt-rh-content"><Outlet /></div></div>
    <nav className="bolt-rh-bottom" aria-label="Navegación móvil">{primary.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}><Icon /><span>{label}</span></NavLink>)}</nav>
  </div>;
}
