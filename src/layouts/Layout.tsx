// src/layouts/Layout.tsx
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import { supabase } from "../lib/supabaseClient";
import { Toast, type ToastKind } from "../components/ui/Toast";
import { useClinic } from "../context/ClinicContext";
import BottomNav from "../components/BottomNav";

const PAGE_TITLES: Record<string, string> = {
  "/overview": "Overview",
  "/inbox": "Inbox",
  "/agenda": "Agenda",
  "/calendar": "Agenda",
  "/marketing": "Marketing IA",
  "/patients": "Patients",
  "/settings": "Settings",
};

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const { setClinic, setClinicId } = useClinic();

  const pageTitle = useMemo(() => {
    const key = Object.keys(PAGE_TITLES).find((path) => location.pathname.startsWith(path));
    return key ? PAGE_TITLES[key] : "Panel";
  }, [location.pathname]);

  function clearLocalCache() {
    try {
      const keysToClear = ["dc_activity_log_v1", "dc_activity_ui_v1", "clinicId", "clinic_id", "organization_id"];
      for (const key of keysToClear) {
        localStorage.removeItem(key);
      }

      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key?.startsWith("dc_")) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // ignore
    }
  }

  async function logout() {
    if (logoutLoading) return;
    setLogoutLoading(true);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("[logout] error", err);
      setToast({ kind: "error", message: "No se pudo cerrar la sesión." });
    } finally {
      clearLocalCache();
      setClinic(null);
      setClinicId(null);
      setLogoutLoading(false);
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden dc-bg text-white">
      <div className="pointer-events-none absolute inset-0 dc-bg-overlay" />
      <div className="relative mx-auto w-full max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex gap-6">
          <div className="hidden shrink-0 lg:block lg:w-[272px]">
            <Sidebar />
          </div>

          <div className="min-w-0 flex-1 overflow-x-hidden pb-24 lg:pb-0">
            <div className="mb-4">
              <Topbar
                onLogout={logout}
                title={pageTitle}
                loading={logoutLoading}
              />
            </div>

            <Outlet />

            <div className="mt-10 flex justify-center">
              <div className="text-[11px] text-white/50">
                Powered by <span className="font-semibold text-[#59E0B8]">CREATYV</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BottomNav />

      <Toast
        open={Boolean(toast)}
        kind={toast?.kind}
        message={toast?.message ?? ""}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
