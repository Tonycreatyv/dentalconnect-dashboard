// src/App.tsx
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "./layouts/Layout";
import Hoy from "./pages/Hoy";
import Tomorrow from "./pages/Tomorrow";
import Inbox from "./pages/Inbox";
import Leads from "./pages/Leads";
import CalendarBoardPage from "./pages/CalendarBoard";
import Patients from "./pages/Patients";
import Settings from "./pages/Settings";
import MarketingAI from "./pages/MarketingAI";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Signup from "./pages/Signup";
import MetaCallback from "./pages/MetaCallback";
import Upgrade from "./pages/Upgrade";
import Billing from "./pages/Billing";
import BillingSuccess from "./pages/BillingSuccess";
import BillingCancel from "./pages/BillingCancel";
import { AuthProvider } from "./context/AuthContext";
import { ClinicProvider } from "./context/ClinicContext";
import { useAuth } from "./context/AuthContext";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center text-sm text-slate-600">
        Cargando…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function AppRoutesInner() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/auth/meta/callback" element={<MetaCallback />} />

      <Route
        path="/upgrade"
        element={
          <RequireAuth>
            <Upgrade />
          </RequireAuth>
        }
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/hoy" replace />} />
        <Route path="overview" element={<Hoy />} />
        <Route path="hoy" element={<Hoy />} />
        <Route path="tomorrow" element={<Tomorrow />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="inbox/:leadId" element={<Inbox />} />
        <Route path="leads" element={<Leads />} />
        <Route path="agenda" element={<CalendarBoardPage />} />
        <Route path="calendar" element={<CalendarBoardPage />} />
        <Route path="marketing" element={<MarketingAI />} />
        <Route path="patients" element={<Patients />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/integrations" element={<Settings />} />
        <Route path="billing" element={<Billing />} />
        <Route path="billing/success" element={<BillingSuccess />} />
        <Route path="billing/cancel" element={<BillingCancel />} />
      </Route>

      <Route path="*" element={<Navigate to="/hoy" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ClinicProvider>
        <AppRoutesInner />
      </ClinicProvider>
    </AuthProvider>
  );
}