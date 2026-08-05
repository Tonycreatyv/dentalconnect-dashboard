import { ArrowLeft, Cable, ChevronRight, LogOut, MapPinned, Package, Settings, ShoppingBasket, Store, Tag } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";

const menu = [
  { to: "/services", label: "Configuración de servicios", icon: Package },
  { to: "/catalog", label: "Tiendas y catálogo", icon: Store },
  { to: "/coupons", label: "Cupones", icon: Tag },
  { to: "/baskets", label: "Canastas", icon: ShoppingBasket },
  { to: "/coverage", label: "Cobertura", icon: MapPinned },
  { to: "/integrations", label: "Integraciones", icon: Cable },
  { to: "/settings#account", label: "Configuración", icon: Settings },
] as const;

export default function ReferralSettings() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  if (location.pathname === "/settings") {
    return <main className="referral-bolt-page">
      <Link className="bolt-rh-back" to="/more"><ArrowLeft />Volver</Link>
      <header className="referral-bolt-page-header"><h1>Configuración</h1><p>Cuenta y sesión</p></header>
      <section id="account" className="referral-bolt-account"><span>Cuenta activa</span><strong>{user?.email || "Sesión activa"}</strong></section>
      <button type="button" className="referral-bolt-logout" onClick={() => void signOut()}><LogOut />Cerrar sesión</button>
    </main>;
  }
  return (
    <main className="referral-bolt-page">
      <header className="referral-bolt-page-header"><h1>Más</h1><p>Configuración y catálogos</p></header>
      <nav className="referral-bolt-menu" aria-label="Configuración">
        {menu.map((item) => <Link key={item.label} to={item.to}><item.icon /><span>{item.label}</span><ChevronRight /></Link>)}
      </nav>
    </main>
  );
}
