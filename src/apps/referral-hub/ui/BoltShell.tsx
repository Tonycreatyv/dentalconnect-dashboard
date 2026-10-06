import { Building2, FileText, Gift, Inbox, MapPin, Menu, MessageCircle, MoreHorizontal, Send, Settings, Store, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import AccountMenu from "./AccountMenu";
import AdminActionPalette from "./AdminActionPalette";
import ConexxionWordmark from "./ConexxionWordmark";
import WorkspaceSwitcher, { type WorkspaceId } from "./WorkspaceSwitcher";
import "./operatorMobile.css";
import "./operatorMobileV2.css";

const referralNav = [
  { to: "/operacion", label: "Inbox", icon: Inbox, end: true },
  { to: "/casos", label: "Casos", icon: FileText, end: false },
  { to: "/clientes", label: "Clientes", icon: Users, end: false },
  { to: "/messages", label: "Mensajes", icon: MessageCircle, end: false },
  { to: "/negocios", label: "Partners", icon: Building2, end: false },
] as const;

const benefitNav = [
  { to: "/negocios?view=cupones", label: "Beneficios", icon: Gift, end: false },
  { to: "/negocios/solicitudes", label: "Entregas", icon: Send, end: false },
  { to: "/network/stores", label: "Ubicaciones", icon: MapPin, end: false },
  { to: "/negocios", label: "Negocios", icon: Store, end: false },
] as const;

const secondaryNav = [
  { to: "/configuracion", label: "Configuración", icon: Settings, end: false },
] as const;

const CHAT_OPEN = /^\/messages\/[^/]+$/;
const FLUSH_CONTENT = /^\/messages(\/|$)/;
const WORKSPACE_STORAGE_KEY = "conexxion-admin-workspace";

function initialWorkspace(pathname: string): WorkspaceId {
  if (pathname.startsWith("/negocios/solicitudes") || pathname.startsWith("/network/stores") || pathname.startsWith("/campanas")) return "benefits";
  const saved = typeof window !== "undefined" ? window.localStorage.getItem(WORKSPACE_STORAGE_KEY) : null;
  return saved === "benefits" ? "benefits" : "referrals";
}

export default function BoltShell() {
  const { loading, error, resolvedOrgName } = useReferralOrganization();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<WorkspaceId>(() => initialWorkspace(location.pathname));
  const isChatOpen = CHAT_OPEN.test(location.pathname);
  const isFlush = FLUSH_CONTENT.test(location.pathname);
  const activeNav = workspace === "referrals" ? referralNav : benefitNav;

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace);
  }, [workspace]);

  const mobileNav = useMemo(() => activeNav.slice(0, 4), [activeNav]);

  function changeWorkspace(next: WorkspaceId) {
    setWorkspace(next);
    setOpen(false);
    navigate(next === "referrals" ? "/operacion" : "/negocios?view=cupones");
  }

  if (loading) return <main className="bolt-rh-loading">Cargando Conexxion…</main>;
  if (error) return <main className="bolt-rh-loading is-error">{error}</main>;

  return <div className={`bolt-rh-shell is-light is-app-height workspace-${workspace}`}>
    <aside className={open ? "bolt-rh-sidebar is-open" : "bolt-rh-sidebar"}>
      <header>
        <div className="bolt-rh-brand"><ConexxionWordmark /><span>{resolvedOrgName || "LG Community Network"}</span></div>
        <button onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></button>
      </header>
      <div className="bolt-rh-workspace-switch"><WorkspaceSwitcher value={workspace} onChange={changeWorkspace} /></div>
      <nav aria-label={`Navegación de ${workspace === "referrals" ? "Referrals" : "Benefits"}`}>
        {activeNav.map(({ to, label, icon: Icon, end }) => <NavLink key={`${workspace}-${to}-${label}`} to={to} end={end} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}
      </nav>
      <div className="bolt-rh-sidebar-divider" />
      <nav aria-label="Configuración">{secondaryNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}</nav>
      <footer>{workspace === "referrals" ? "Referral workspace" : "Benefits workspace"}</footer>
    </aside>

    {open ? <button className="bolt-rh-scrim" onClick={() => setOpen(false)} aria-label="Cerrar menú" /> : null}

    <div className="bolt-rh-workspace">
      <header className="bolt-rh-topbar">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button>
        <div className="bolt-rh-topbar-brand"><ConexxionWordmark /><span>{resolvedOrgName || "LG Community Network"}</span></div>
        <WorkspaceSwitcher value={workspace} onChange={changeWorkspace} />
        <AccountMenu />
      </header>
      <div className={isFlush ? "bolt-rh-content is-flush" : "bolt-rh-content"}><Outlet /></div>
    </div>

    {!isChatOpen ? <AdminActionPalette /> : null}

    <nav className={isChatOpen ? "bolt-rh-bottom is-hidden" : "bolt-rh-bottom"} aria-label="Navegación móvil">
      {mobileNav.map(({ to, label, icon: Icon, end }) => <NavLink key={`${workspace}-mobile-${to}-${label}`} to={to} end={end}><Icon /><span>{label}</span></NavLink>)}
      <button type="button" className="bolt-rh-bottom-more" onClick={() => setOpen(true)} aria-label="Más opciones"><MoreHorizontal /><span>Más</span></button>
    </nav>
  </div>;
}
