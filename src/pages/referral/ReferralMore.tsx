import { useEffect, useState } from "react";
import { Building2, Facebook, GitBranch, LogOut, ScanLine, Unplug, User, Users } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { startMetaOAuth } from "../../components/integrations/ConnectMessengerButton";
import { MobileCard, MobileHeader } from "../../components/mobile/MobilePrimitives";
import { REFERRAL_HUB_ORG_ID } from "../../config/referralHub";
import { useAuth } from "../../context/AuthContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { supabase } from "../../lib/supabaseClient";

type MessengerStatus = {
  meta_page_id: string | null;
  meta_page_name: string | null;
  messenger_enabled: boolean;
};

const EMPTY_STATUS: MessengerStatus = {
  meta_page_id: null,
  meta_page_name: null,
  messenger_enabled: false,
};

export default function ReferralMore() {
  const { user, signOut } = useAuth();
  const { resolvedOrgId, resolvedOrgName, resolvedBusinessType } = useActiveOrg();
  const location = useLocation();
  const navigate = useNavigate();
  const [messenger, setMessenger] = useState<MessengerStatus>(EMPTY_STATUS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const isCanonicalLg = resolvedOrgId === REFERRAL_HUB_ORG_ID && resolvedBusinessType === "referral_hub";

  async function loadMessengerStatus() {
    if (!resolvedOrgId || resolvedBusinessType !== "referral_hub") {
      setMessenger(EMPTY_STATUS);
      return;
    }
    const result = await supabase
      .from("org_settings")
      .select("meta_page_id,meta_page_name,messenger_enabled")
      .eq("organization_id", resolvedOrgId)
      .maybeSingle();
    if (result.error || !result.data) {
      setMessenger(EMPTY_STATUS);
      return;
    }
    setMessenger({
      meta_page_id: result.data.meta_page_id ?? null,
      meta_page_name: result.data.meta_page_name ?? null,
      messenger_enabled: result.data.messenger_enabled === true,
    });
  }

  useEffect(() => {
    void loadMessengerStatus();
  }, [resolvedOrgId, resolvedBusinessType]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("connected") !== "1") return;
    setNotice("Messenger conectado correctamente.");
    void loadMessengerStatus();
    params.delete("connected");
    params.delete("org");
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  async function connectMessenger() {
    if (!isCanonicalLg || !resolvedOrgId) {
      setNotice("Selecciona LG Community Network antes de conectar una página.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      localStorage.setItem("dc_post_meta_redirect", "/more");
      await startMetaOAuth(resolvedOrgId);
    } catch (error) {
      setBusy(false);
      setNotice(String((error as Error)?.message ?? "No se pudo iniciar la conexión."));
    }
  }

  async function disconnectMessenger() {
    if (!isCanonicalLg || !resolvedOrgId) return;
    if (!window.confirm("¿Desconectar Messenger de LG Community Network?")) return;
    setBusy(true);
    const result = await supabase
      .from("org_settings")
      .update({
        messenger_enabled: false,
        meta_page_id: null,
        meta_page_name: null,
        meta_page_access_token: null,
        meta_connected_at: null,
        meta_last_error: null,
      })
      .eq("organization_id", resolvedOrgId);
    setBusy(false);
    setNotice(result.error ? "No se pudo desconectar Messenger." : "Messenger desconectado.");
    if (!result.error) await loadMessengerStatus();
  }

  const connected = Boolean(messenger.meta_page_id && messenger.messenger_enabled);

  return (
    <main className="referral-page">
      <MobileHeader eyebrow="Cuenta" title="Más" subtitle="Herramientas y configuración" />
      <div className="grid gap-2">
        {false ? <Link to="/coupons/validate" className="coupon-more-link"><ScanLine className="h-5 w-5"/><span><strong>Validar cupón</strong><small>Escanear QR o ingresar código</small></span></Link> : null}
        <Link to="/leads" className="coupon-more-link"><Users className="h-5 w-5"/><span><strong>Leads</strong><small>Consultar referidos y clientes</small></span></Link>
        <Link to="/pipeline" className="coupon-more-link"><GitBranch className="h-5 w-5"/><span><strong>Pipeline</strong><small>Revisar oportunidades por etapa</small></span></Link>
      </div>

      <MobileCard className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1877F2]/10 text-[#5A9CF5]"><Facebook className="h-5 w-5" /></div>
            <div className="min-w-0">
              <strong className="block text-sm text-white">Messenger</strong>
              <span className="text-xs text-[#7E8C99]">{connected ? "Página conectada" : "No conectado"}</span>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${connected ? "bg-[#25D366]/10 text-[#70D998]" : "bg-white/5 text-[#7E8C99]"}`}>
            {connected ? "Activo" : "Inactivo"}
          </span>
        </div>
        {connected ? (
          <div className="rounded-xl border border-[#25384A] bg-[#0A141D] p-3 text-xs">
            <div className="font-semibold text-white">{messenger.meta_page_name || "Página de Facebook"}</div>
            <div className="mt-1 text-[#7E8C99]">Page ID: {messenger.meta_page_id}</div>
          </div>
        ) : null}
        {notice ? <p className="text-xs text-[#9CAAB8]">{notice}</p> : null}
        {connected ? (
          <button type="button" disabled={busy || !isCanonicalLg} onClick={() => void disconnectMessenger()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-bold text-white disabled:opacity-50">
            <Unplug className="h-4 w-4" />Desconectar Messenger
          </button>
        ) : (
          <button type="button" disabled={busy || !isCanonicalLg} onClick={() => void connectMessenger()} className="min-h-11 w-full rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Conectando..." : "Conectar Messenger"}
          </button>
        )}
      </MobileCard>

      <MobileCard className="space-y-1">
        <div className="referral-account-row"><User className="h-4 w-4" /><div><span>Cuenta</span><strong>{user?.email ?? "Sesión activa"}</strong></div></div>
        <div className="referral-account-row"><Building2 className="h-4 w-4" /><div><span>Organización</span><strong>{resolvedOrgName || "Referral Hub"}</strong></div></div>
      </MobileCard>
      <button type="button" onClick={() => void signOut()} className="referral-logout"><LogOut className="h-4 w-4" />Cerrar sesión</button>
      <p className="text-center text-[11px] text-[#536170]">Referral Hub · Powered by Creatyv</p>
    </main>
  );
}
