import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import MetaCallback from "../../pages/auth/MetaCallback";
import ReferralHome from "../../pages/referral/ReferralHome";
import ReferralLeads from "../../pages/referral/ReferralLeads";
import ReferralLeadDetail from "../../pages/referral/ReferralLeadDetail";
import ReferralQualification from "../../pages/referral/ReferralQualification";
import ReferralKanban from "../../pages/referral/ReferralKanban";
import ReferralMore from "../../pages/referral/ReferralMore";
import ReferralOrders from "../../pages/referral/ReferralOrders";
import CouponValidator from "../../pages/referral/CouponValidator";
import PublicCoupon from "../../pages/referral/PublicCoupon";
import ReferralLogin from "./pages/ReferralLogin";
import ReferralMessages from "./pages/ReferralMessages";
import ReferralShell from "./components/ReferralShell";
import { ReferralOrganizationProvider, useReferralOrganization } from "./organizations/ReferralOrganizationContext";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="min-h-screen bg-[#071018] p-8 text-white">Cargando…</main>;
  return session ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

function ProductRoutes() {
  const { features } = useReferralOrganization();
  return <Routes>
    <Route path="/login" element={<ReferralLogin />} />
    <Route path="/auth/meta/callback" element={<RequireAuth><MetaCallback /></RequireAuth>} />
    <Route path="/coupon/:publicToken" element={<PublicCoupon />} />
    <Route path="/" element={<RequireAuth><ReferralShell /></RequireAuth>}>
      <Route index element={<ReferralHome />} />
      {features.lg_leads_enabled ? <Route path="leads" element={<ReferralLeads />} /> : null}
      {features.lg_leads_enabled ? <Route path="leads/:leadId" element={<ReferralLeadDetail />} /> : null}
      {features.lg_leads_enabled ? <Route path="leads/:leadId/qualify" element={<ReferralQualification />} /> : null}
      {features.lg_leads_enabled ? <Route path="pipeline" element={<ReferralKanban />} /> : null}
      <Route path="messages" element={<ReferralMessages />} />
      {features.lg_grocery_orders_enabled ? <Route path="orders" element={<ReferralOrders />} /> : null}
      {features.lg_coupon_delivery_enabled ? <Route path="coupons/validate" element={<CouponValidator />} /> : null}
      <Route path="more" element={<ReferralMore />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function ReferralHubApp() {
  return <AuthProvider><ReferralOrganizationProvider><ProductRoutes /></ReferralOrganizationProvider></AuthProvider>;
}
