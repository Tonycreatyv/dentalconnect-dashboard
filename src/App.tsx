// src/App.tsx
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "./layouts/Layout";

import Overview from "./pages/Overview";
import Inbox from "./pages/Inbox";
import CalendarBoardPage from "./pages/CalendarBoard";
import Patients from "./pages/Patients";
import Settings from "./pages/Settings";
import MarketingAI from "./pages/MarketingAI";
import Login from "./pages/Login";

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
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/overview" replace />} />

        <Route path="overview" element={<Overview />} />

        <Route path="inbox" element={<Inbox />} />
        <Route path="inbox/:leadId" element={<Inbox />} />

        <Route path="agenda" element={<CalendarBoardPage />} />
        <Route path="calendar" element={<CalendarBoardPage />} />

        <Route path="marketing" element={<MarketingAI />} />

        <Route path="patients" element={<Patients />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/overview" replace />} />
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
