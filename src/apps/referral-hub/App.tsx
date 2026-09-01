import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import MetaCallback from "../../pages/auth/MetaCallback";
import CouponValidator from "../../pages/referral/CouponValidator";
import PublicCoupon from "../../pages/referral/PublicCoupon";
import PartnerPortal from "../referral-partner/pages/PartnerPortal";
import { PartnerLogin, RequirePartner, Shell as PartnerShell } from "../referral-partner/PartnerDashboard";
import BoltShell from "./ui/BoltShell";
import RedirectWithSearch from "./RedirectWithSearch";
import ReferralLogin from "./pages/ReferralLogin";
import ReferralServices from "./pages/ReferralServices";
import ReferralServiceDetail from "./pages/ReferralServiceDetail";
import ReferralIntegrations from "./pages/ReferralIntegrations";
import ReferralConfiguracion from "./pages/ReferralConfiguracion";
import ReferralQrEntry from "./pages/ReferralQrEntry";
import { ReferralOrganizationProvider, useReferralOrganization } from "./organizations/ReferralOrganizationContext";
import { OrderDetailScreen, OrdersScreen, StoresScreen, WorkScreen } from "./screens/CoreScreens";
import { BasketLocationScreen, BasketOfferScreen, BasketsScreen, CatalogScreen, CouponDetailScreen, StoreWorkspaceScreen } from "./screens/CatalogScreens";
import { ClientesScreen, ContactDetailScreen, CouponRequestsScreen, InicioScreen } from "./screens/DashboardScreens";
import CampaignsHub from "./screens/CampaignsAdmin";
import { BusinessDetailScreen, CampaignDetailScreen, ServiceDetailScreen } from "./screens/CatalogDetail";
import MessagesWorkspace from "./screens/MessagesWorkspace";
import EmptyState from "./ui/EmptyState";
import NegociosHub from "./negocios/NegociosScreens";
import NegociosBusinessDetail from "./negocios/BusinessDetail";
import NegociosCouponEditor from "./negocios/CouponEditor";
import { useReferralOrders } from "../../referral/useReferralOrders";
import { Lock } from "lucide-react";

function RequireAuth({ children }: { children: JSX.Element }) { const { session, loading } = useAuth(); const location = useLocation(); if (loading) return <main className="bolt-rh-loading">Cargando…</main>; return session ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />; }
function Unavailable({ title, message }: { title: string; message: string }) { return <div className="hub-page"><EmptyState icon={Lock} title={title} description={message} /></div>; }
function OrdersGate({ detail = false }: { detail?: boolean }) { const { features } = useReferralOrganization(); const orders = useReferralOrders(); if (orders.loading) return <main className="bolt-rh-loading">Comprobando pedidos…</main>; return features.lg_grocery_orders_enabled || orders.orders.length > 0 ? (detail ? <OrderDetailScreen /> : <OrdersScreen />) : <Unavailable title="Pedidos" message="Esta función no está habilitada para tu cuenta." />; }
function BasketsGate({ children }: { children: JSX.Element }) { const { features } = useReferralOrganization(); return features.lg_grocery_orders_enabled ? children : <Unavailable title="Canastas" message="Esta función no está habilitada para tu cuenta." />; }
function ServicesGate({ detail = false }: { detail?: boolean }) { const { features } = useReferralOrganization(); return features.lg_services_enabled ? (detail ? <ReferralServiceDetail /> : <ReferralServices />) : <Unavailable title="Configuración de servicios" message="Esta función no está habilitada para tu cuenta." />; }

function ProductRoutes() {
  return <Routes>
    <Route path="/login" element={<ReferralLogin />} />
    <Route path="/auth/meta/callback" element={<RequireAuth><MetaCallback /></RequireAuth>} />
    <Route path="/coupon/:publicToken" element={<PublicCoupon />} />
    <Route path="/q/:publicCode" element={<ReferralQrEntry />} />
    <Route path="/partner/:token" element={<PartnerPortal />} />
    {/* Nested under /partner (not two flat sibling routes, and not a bare
        /partner/* route) so the static "login"/"app" segments always outrank
        the dynamic :token route above for those exact paths — React Router
        ranks a bare /partner/* splat BELOW /partner/:token, which would
        silently route the dashboard through PartnerPortal instead. */}
    <Route path="/partner">
      <Route path="login" element={<PartnerLogin />} />
      <Route path="app/*" element={<RequirePartner><PartnerShell /></RequirePartner>} />
    </Route>
    <Route path="/" element={<RequireAuth><ReferralOrganizationProvider><BoltShell /></ReferralOrganizationProvider></RequireAuth>}>
      <Route index element={<InicioScreen />} />
      <Route path="clientes" element={<ClientesScreen />} />
      <Route path="clientes/:leadId" element={<ContactDetailScreen />} />
      <Route path="messages" element={<MessagesWorkspace />} />
      <Route path="messages/:conversationId" element={<MessagesWorkspace />} />
      <Route path="campanas" element={<CampaignsHub />} />
      <Route path="campanas/campana/:campaignId" element={<CampaignDetailScreen />} />
      <Route path="campanas/servicio/:serviceId" element={<ServiceDetailScreen />} />
      <Route path="campanas/negocio/:businessId" element={<BusinessDetailScreen />} />

      {/* New business-centered tree (isolated module, local demo data only —
          see src/apps/referral-hub/negocios/dataSource.ts). Primary nav now
          points here instead of campanas; /campanas* above stays live and
          reachable by URL, unredirected, until this tree is reviewed and
          approved for cutover. */}
      <Route path="negocios" element={<NegociosHub />} />
      <Route path="negocios/negocio/:businessId" element={<NegociosBusinessDetail />} />
      <Route path="negocios/cupon/:couponId" element={<NegociosCouponEditor />} />
      <Route path="negocios/solicitudes" element={<CouponRequestsScreen />} />

      {/* Legacy routes preserved and functional, reachable from Perfil (not primary nav). */}
      <Route path="work" element={<WorkScreen />} />
      <Route path="work/:itemId" element={<Navigate to="/work" replace />} />
      <Route path="orders" element={<OrdersGate />} />
      <Route path="orders/:orderId" element={<OrdersGate detail />} />
      {/* /more was a near-duplicate, profile-only page — replaced by
          Configuración (now directly reachable from primary nav), so it
          redirects (history "replace", not "push") to preserve back
          behavior instead of leaving a dead end or a back-button loop. */}
      <Route path="more" element={<RedirectWithSearch to="/configuracion" />} />
      <Route path="configuracion" element={<ReferralConfiguracion />} />
      <Route path="baskets" element={<BasketsGate><BasketsScreen /></BasketsGate>} />
      <Route path="baskets/:locationId" element={<BasketsGate><BasketLocationScreen /></BasketsGate>} />
      <Route path="baskets/:locationId/:offerId" element={<BasketsGate><BasketOfferScreen /></BasketsGate>} />
      <Route path="benefits/claims" element={<RedirectWithSearch to="/clientes" />} />
      <Route path="coupons" element={<RedirectWithSearch to="/campanas" />} />
      <Route path="coupons/:couponId" element={<CouponDetailScreen />} />
      <Route path="coupons/validate" element={<CouponValidator />} />
      <Route path="validate-coupon/:publicToken" element={<CouponValidator />} />
      <Route path="coverage" element={<RedirectWithSearch to="/campanas?view=negocios" />} />
      <Route path="coverage/:locationId" element={<RedirectWithSearch to="/campanas?view=negocios" />} />
      <Route path="catalog" element={<CatalogScreen />} />
      <Route path="integrations" element={<ReferralIntegrations />} />
      <Route path="qr-campaigns" element={<RedirectWithSearch to="/campanas" />} />
      <Route path="settings" element={<ReferralConfiguracion />} />

      {/* Explicitly moved per the new information architecture. */}
      <Route path="leads" element={<RedirectWithSearch to="/clientes" />} />
      <Route path="cupones" element={<RedirectWithSearch to="/campanas" />} />
      <Route path="services" element={<RedirectWithSearch to="/campanas?view=servicios" />} />
      <Route path="services/:serviceId" element={<ServicesGate detail />} />
      <Route path="settings/services" element={<ServicesGate />} />
      <Route path="network" element={<RedirectWithSearch to="/campanas?view=negocios" />} />
      <Route path="network/allies" element={<RedirectWithSearch to="/campanas?view=negocios" />} />
      <Route path="network/allies/:allyId" element={<RedirectWithSearch to="/campanas?view=negocios" />} />
      <Route path="network/stores" element={<StoresScreen />} />
      <Route path="network/stores/:locationId" element={<StoreWorkspaceScreen />} />
      <Route path="network/stores/:locationId/baskets" element={<StoreWorkspaceScreen section="baskets" />} />
      <Route path="network/stores/:locationId/coupons" element={<StoreWorkspaceScreen section="coupons" />} />
      <Route path="network/stores/:locationId/coverage" element={<StoreWorkspaceScreen section="coverage" />} />
      <Route path="network/stores/:locationId/activity" element={<StoreWorkspaceScreen section="activity" />} />
      <Route path="attention" element={<Navigate to="/work" replace />} />
      <Route path="opportunities" element={<Navigate to="/work?tab=seguimiento" replace />} />
      <Route path="assignments" element={<Navigate to="/work?tab=seguimiento" replace />} />
      <Route path="partners" element={<Navigate to="/campanas?view=negocios" replace />} />
      <Route path="partner-contacts" element={<Navigate to="/campanas?view=negocios" replace />} />
      <Route path="supermarkets" element={<Navigate to="/campanas?view=negocios" replace />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function ReferralHubApp(){return <AuthProvider><ProductRoutes/></AuthProvider>}
