import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import MetaCallback from "../../pages/auth/MetaCallback";
import CouponValidator from "../../pages/referral/CouponValidator";
import PublicCoupon from "../../pages/referral/PublicCoupon";
import ReferralMore from "../../pages/referral/ReferralMore";
import PartnerPortal from "../referral-partner/pages/PartnerPortal";
import BoltShell from "./ui/BoltShell";
import ReferralLogin from "./pages/ReferralLogin";
import ReferralServices from "./pages/ReferralServices";
import ReferralServiceDetail from "./pages/ReferralServiceDetail";
import ReferralSettings from "./pages/ReferralSettings";
import { ReferralOrganizationProvider, useReferralOrganization } from "./organizations/ReferralOrganizationContext";
import { AlliesScreen, AllyDetailScreen, ConversationScreen, HomeScreen, InboxScreen, NetworkScreen, OrderDetailScreen, OrdersScreen, StoresScreen, WorkScreen } from "./screens/CoreScreens";
import { BasketLocationScreen, BasketOfferScreen, BasketsScreen, CatalogScreen, CouponDetailScreen, CouponsScreen, CoverageLocationScreen, CoverageScreen, StoreWorkspaceScreen } from "./screens/CatalogScreens";
import { useReferralOrders } from "../../referral/useReferralOrders";

function RequireAuth({ children }: { children: JSX.Element }) { const { session, loading } = useAuth(); const location = useLocation(); if (loading) return <main className="bolt-rh-loading">Cargando…</main>; return session ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />; }
function Unavailable({ title, message }: { title: string; message: string }) { return <main className="bolt-rh-page"><header className="bolt-rh-heading"><h1>{title}</h1><p>{message}</p></header></main>; }
function OrdersGate({ detail = false }: { detail?: boolean }) { const { features } = useReferralOrganization(); const orders = useReferralOrders(); if (orders.loading) return <main className="bolt-rh-loading">Comprobando pedidos…</main>; return features.lg_grocery_orders_enabled || orders.orders.length > 0 ? (detail ? <OrderDetailScreen /> : <OrdersScreen />) : <Unavailable title="Pedidos" message="Esta función no está habilitada para tu cuenta." />; }

function ProductRoutes() {
  const { features } = useReferralOrganization();
  return <Routes>
    <Route path="/login" element={<ReferralLogin />} />
    <Route path="/auth/meta/callback" element={<RequireAuth><MetaCallback /></RequireAuth>} />
    <Route path="/coupon/:publicToken" element={<PublicCoupon />} />
    <Route path="/partner/:token" element={<PartnerPortal />} />
    <Route path="/" element={<RequireAuth><BoltShell /></RequireAuth>}>
      <Route index element={<HomeScreen />} />
      <Route path="messages" element={<InboxScreen />} />
      <Route path="messages/:conversationId" element={<ConversationScreen />} />
      <Route path="work" element={<WorkScreen />} />
      <Route path="work/:itemId" element={<Navigate to="/work" replace />} />
      <Route path="orders" element={<OrdersGate />} />
      <Route path="orders/:orderId" element={<OrdersGate detail />} />
      <Route path="network" element={<NetworkScreen />} />
      <Route path="network/allies" element={<AlliesScreen />} />
      <Route path="network/allies/:allyId" element={<AllyDetailScreen />} />
      <Route path="network/stores" element={<StoresScreen />} />
      <Route path="network/stores/:locationId" element={<StoreWorkspaceScreen />} />
      <Route path="network/stores/:locationId/baskets" element={<StoreWorkspaceScreen section="baskets" />} />
      <Route path="network/stores/:locationId/coupons" element={<StoreWorkspaceScreen section="coupons" />} />
      <Route path="network/stores/:locationId/coverage" element={<StoreWorkspaceScreen section="coverage" />} />
      <Route path="network/stores/:locationId/activity" element={<StoreWorkspaceScreen section="activity" />} />
      <Route path="more" element={<ReferralSettings />} />
      <Route path="services" element={features.lg_services_enabled ? <ReferralServices /> : <Unavailable title="Configuración de servicios" message="Esta función no está habilitada para tu cuenta." />} />
      <Route path="services/:serviceId" element={features.lg_services_enabled ? <ReferralServiceDetail /> : <Unavailable title="Configuración de servicios" message="Esta función no está habilitada para tu cuenta." />} />
      <Route path="baskets" element={<BasketsScreen />} />
      <Route path="baskets/:locationId" element={<BasketLocationScreen />} />
      <Route path="baskets/:locationId/:offerId" element={<BasketOfferScreen />} />
      <Route path="coupons" element={<CouponsScreen />} />
      <Route path="coupons/:couponId" element={<CouponDetailScreen />} />
      <Route path="coupons/validate" element={<CouponValidator />} />
      <Route path="validate-coupon/:publicToken" element={<CouponValidator />} />
      <Route path="coverage" element={<CoverageScreen />} />
      <Route path="coverage/:locationId" element={<CoverageLocationScreen />} />
      <Route path="catalog" element={<CatalogScreen />} />
      <Route path="integrations" element={<ReferralMore />} />
      <Route path="settings" element={<ReferralSettings />} />
      <Route path="attention" element={<Navigate to="/work" replace />} />
      <Route path="opportunities" element={<Navigate to="/work?tab=seguimiento" replace />} />
      <Route path="assignments" element={<Navigate to="/work?tab=seguimiento" replace />} />
      <Route path="partners" element={<Navigate to="/network/allies" replace />} />
      <Route path="partner-contacts" element={<Navigate to="/network/allies" replace />} />
      <Route path="supermarkets" element={<Navigate to="/network/stores" replace />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function ReferralHubApp(){return <AuthProvider><ReferralOrganizationProvider><ProductRoutes/></ReferralOrganizationProvider></AuthProvider>}
