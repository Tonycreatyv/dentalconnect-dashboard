import { Building2, Home, Menu, MessageCircle, Settings, Users, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import AccountMenu from "./AccountMenu";
import ConexxionWordmark from "./ConexxionWordmark";

// Points at the new business-centered /negocios tree (see
// src/apps/referral-hub/negocios/). The old /campanas* tree stays fully
// live and reachable by direct URL — nothing was deleted or redirected —
// it's simply no longer linked from primary nav.
const primaryNav = [
  { to: "/", label: "Inicio", icon: Home, end: true },
  { to: "/negocios", label: "Negocios", icon: Building2, end: false },
  { to: "/messages", label: "Mensajes", icon: MessageCircle, end: false },
  { to: "/clientes", label: "Clientes", icon: Users, end: false },
] as const;

// Rendered in the desktop sidebar and the mobile slide-out menu (the same
// <aside> markup, just toggled via the hamburger on mobile) — not the
// bottom tab bar, which stays reserved for the 4 highest-frequency
// destinations. The avatar/account menu still links here too, but this is
// what makes Configuración discoverable WITHOUT knowing that shortcut
// exists.
const secondaryNav = [
  { to: "/configuracion", label: "Configuración", icon: Settings, end: false },
] as const;

const CHAT_OPEN = /^\/messages\/[^/]+$/;
const FLUSH_CONTENT = /^\/messages(\/|$)/;

export default function BoltShell() {
  const { loading, error, resolvedOrgName } = useReferralOrganization();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isChatOpen = CHAT_OPEN.test(location.pathname);
  const isFlush = FLUSH_CONTENT.test(location.pathname);
  if (loading) return <main className="bolt-rh-loading">Cargando Conexxion…</main>;
  if (error) return <main className="bolt-rh-loading is-error">{error}</main>;
  return <div className="bolt-rh-shell is-light is-app-height">
    <aside className={open ? "bolt-rh-sidebar is-open" : "bolt-rh-sidebar"}>
      <header><div className="bolt-rh-brand"><ConexxionWordmark /><span>{resolvedOrgName || "LG Community Network"}</span></div><button onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></button></header>
      <nav aria-label="Navegación principal">{primaryNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}</nav>
      <div className="bolt-rh-sidebar-divider" />
      <nav aria-label="Configuración">{secondaryNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}</nav>
      <footer>Panel administrativo</footer>
    </aside>
    {open ? <button className="bolt-rh-scrim" onClick={() => setOpen(false)} aria-label="Cerrar menú" /> : null}
    <div className="bolt-rh-workspace">
      <header className="bolt-rh-topbar">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button>
        <ConexxionWordmark /><span>{resolvedOrgName || "LG Community Network"}</span>
        <AccountMenu />
      </header>
      <div className={isFlush ? "bolt-rh-content is-flush" : "bolt-rh-content"}><Outlet /></div>
    </div>
    <nav className={isChatOpen ? "bolt-rh-bottom is-hidden" : "bolt-rh-bottom"} aria-label="Navegación móvil">{primaryNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}><Icon /><span>{label}</span></NavLink>)}</nav>
  </div>;
}
