// src/routes.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./layouts/Layout";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/ReportsDashboard";
import Conversations from "./pages/Conversations";
import Patients from "./pages/Patients";
import PatientDetail from "./pages/PatientDetail";
import Appointments from "./pages/Appointments";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import MetaCallback from "./pages/MetaCallback";

export const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />

          <Route path="/conversations" element={<Conversations />} />
          <Route path="/conversations/:leadId" element={<Conversations />} />

          <Route path="/patients" element={<Patients />} />
          <Route path="/patients/:patientId" element={<PatientDetail />} />

          <Route path="/appointments" element={<Appointments />} />

          <Route path="/integrations/meta/callback" element={<MetaCallback />} />

          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};