import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Facebook, Unplug } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { startMetaOAuth } from "../../components/integrations/ConnectMessengerButton";
import { REFERRAL_HUB_ORG_ID } from "../../config/referralHub";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { supabase } from "../../lib/supabaseClient";
import WhatsAppConnect from "../../components/WhatsAppConnect";

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
  const { resolvedOrgId, resolvedBusinessType } = useActiveOrg();
  const location = useLocation();
  const navigate = useNavigate();
  const [messenger, setMessenger] = useState<MessengerStatus>(EMPTY_STATUS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const isCanonicalLg = resolvedOrgId === REFERRAL_HUB_ORG_ID && resolvedBusinessType === "referral_hub";

  const loadMessengerStatus = useCallback(async () => {
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
  }, [resolvedBusinessType, resolvedOrgId]);

  useEffect(() => {
    void loadMessengerStatus();
  }, [loadMessengerStatus]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("connected") !== "1") return;
    setNotice("Messenger conectado correctamente.");
    void loadMessengerStatus();
    params.delete("connected");
    params.delete("org");
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
  }, [loadMessengerStatus, location.pathname, location.search, navigate]);

  async function connectMessenger() {
    if (!isCanonicalLg || !resolvedOrgId) {
      setNotice("Selecciona LG Community Network antes de conectar una página.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      localStorage.setItem("dc_post_meta_redirect", "/integrations");
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
    <main className="bolt-rh-page">
      <Link className="bolt-rh-back" to="/more"><ArrowLeft />Volver</Link>
      <header className="bolt-rh-heading"><h1>Integraciones</h1><p>Canales conectados a LG Community Network.</p></header>
      <div className="grid gap-3 md:grid-cols-2">
      <section className="space-y-3 rounded-lg border border-[#272a30] bg-[#101114] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1877F2]/10 text-[#5A9CF5]"><Facebook className="h-5 w-5" /></div>
            <div className="min-w-0">
              <strong className="block text-sm text-white">{messenger.meta_page_name || "Messenger"}</strong>
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
            <div className="mt-1 text-[#7E8C99]">Lista para recibir y responder mensajes.</div>
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
      </section>
      <WhatsAppConnect organizationId={resolvedOrgId || REFERRAL_HUB_ORG_ID} businessType="referral_hub" />
      </div>
    </main>
  );
}
