// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./layouts/Layout";

import Overview from "./pages/Overview";
import Inbox from "./pages/Inbox";
import CalendarBoardPage from "./pages/CalendarBoard";
import Patients from "./pages/Patients";
import Settings from "./pages/Settings";
import MarketingAI from "./pages/MarketingAI";

import { AuthProvider } from "./context/AuthContext";
import { ClinicProvider } from "./context/ClinicContext";

function AppRoutesInner() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
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
