// src/layouts/Layout.tsx
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import { supabase } from "../lib/supabaseClient";
import { Toast, type ToastKind } from "../components/ui/Toast";
import { useClinic } from "../context/ClinicContext";
import BottomNav from "../components/BottomNav";

const PAGE_TITLES: Record<string, string> = {
  "/hoy": "Hoy",
  "/tomorrow": "Mañana",
  "/overview": "Hoy",
  "/inbox": "Inbox",
  "/leads": "Leads",
  "/agenda": "Agenda",
  "/calendar": "Agenda",
  "/marketing": "Marketing",
  "/patients": "Pacientes",
  "/billing": "Billing",
  "/settings": "Ajustes",
};

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const { clinic, setClinic, setClinicId } = useClinic();
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [trialExpired, setTrialExpired] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  useEffect(() => {
    let mounted = true;
    const orgId = clinic?.organization_id ?? "clinic-demo";

    async function checkTrial() {
      const sub = await supabase
        .from("subscriptions")
        .select("status, trial_ends_at")
        .eq("organization_id", orgId)
        .maybeSingle();

      if (mounted && !sub.error && sub.data) {
        const status = String((sub.data as any).status ?? "");
        const trialEndsAt = (sub.data as any).trial_ends_at as string | null;
        if (status === "active") {
          setTrialDaysLeft(null);
          setTrialExpired(false);
          return;
        }
        if (status === "trialing" && trialEndsAt) {
          const diffMs = new Date(trialEndsAt).getTime() - Date.now();
          const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
          setTrialDaysLeft(days);
          if (diffMs <= 0) {
            setTrialExpired(true);
            navigate("/billing", { replace: true });
          } else {
            setTrialExpired(false);
          }
          return;
        }
      }

      const res = await supabase
        .from("org_settings")
        .select("plan, trial_ends_at, is_trial_active, messenger_enabled")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!mounted || res.error || !res.data) return;

      const plan = String((res.data as any).plan ?? "trial");
      const trialEndsAt = (res.data as any).trial_ends_at as string | null;
      if (plan === "pro" || !trialEndsAt) {
        setTrialDaysLeft(null);
        setTrialExpired(false);
        return;
      }

      const diffMs = new Date(trialEndsAt).getTime() - Date.now();
      const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      setTrialDaysLeft(days);

      if (diffMs <= 0) {
        setTrialExpired(true);
        await supabase
          .from("org_settings")
          .update({
            is_trial_active: false,
            messenger_enabled: false,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", orgId);
        navigate("/billing", { replace: true });
      } else {
        setTrialExpired(false);
      }
    }

    checkTrial();
    return () => {
      mounted = false;
    };
  }, [clinic?.organization_id, navigate]);

  return (
    <div className="relative min-h-screen overflow-x-hidden dc-bg text-white">
      <div className="pointer-events-none absolute inset-0 dc-bg-overlay" />
      <div className="relative mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex gap-6">
          <div className="hidden shrink-0 lg:block lg:w-[272px]">
            <Sidebar />
          </div>

          <div className="min-w-0 flex-1 overflow-x-hidden pb-24 lg:pb-0">
            <div className="mb-4">
              <Topbar
                onLogout={logout}
                onMenu={() => setMobileMenuOpen(true)}
                title={pageTitle}
                loading={logoutLoading}
              />
            </div>

            {!trialExpired && trialDaysLeft !== null ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#3CBDB9]/30 bg-[#0894C1]/10 px-4 py-3 text-sm text-white/90">
                <span>
                  Te quedan {trialDaysLeft} {trialDaysLeft === 1 ? "día" : "días"} de trial.
                </span>
                <button
                  type="button"
                  onClick={() => navigate("/billing")}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                >
                  Ver planes
                </button>
              </div>
            ) : null}

            <Outlet />

            <div className="mt-10 flex justify-center">
              <div className="text-[11px] text-white/50">
                Powered by <span className="font-semibold text-[#59E0B8]">CREATYV</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Cerrar menú"
          />
          <div className="absolute left-0 top-0 h-full w-[88vw] max-w-[320px] p-3 pt-[max(env(safe-area-inset-top),12px)]">
            <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      ) : null}

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
