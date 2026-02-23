// src/layouts/Layout.tsx
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import { supabase } from "../lib/supabaseClient";

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
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageTitle = useMemo(() => {
    const key = Object.keys(PAGE_TITLES).find((path) => location.pathname.startsWith(path));
    return key ? PAGE_TITLES[key] : "Panel";
  }, [location.pathname]);

  async function logout() {
    try {
      await supabase.auth.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-slate-900 overflow-x-hidden">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex gap-6">
          <div className="hidden shrink-0 lg:block lg:w-[272px]">
            <Sidebar />
          </div>

          <div className="min-w-0 flex-1 overflow-x-hidden">
            <div className="mb-4">
              <Topbar
                onLogout={logout}
                onMenu={() => setMobileOpen(true)}
                title={pageTitle}
              />
            </div>

            <Outlet />

            <div className="mt-10 flex justify-center">
              <div className="text-[11px] text-slate-500">
                Powered by <span className="text-blue-600 font-semibold">CREATYV</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div
            className="absolute left-0 top-0 h-full w-[272px] bg-[#0F172A] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
