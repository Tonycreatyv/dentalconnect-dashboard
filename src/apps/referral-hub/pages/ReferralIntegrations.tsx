import { CheckCircle2, MessageCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import WhatsAppConnect from "../../../components/WhatsAppConnect";
import { supabase } from "../../../lib/supabaseClient";
import { mayStartWhatsAppEmbeddedSignup } from "../../../lib/whatsappConnectionState";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

type Integration = { provider: "messenger"; status: "connected" | "pending" | "error" | "disconnected" };
const channels = [
  { provider: "messenger" as const, title: "Messenger", copy: "Mantén tus conversaciones de Facebook en un solo lugar.", icon: MessageCircle },
];

export default function ReferralIntegrations() {
  const { resolvedOrgId, membershipRole } = useReferralOrganization();
  const [rows, setRows] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.provider, row])), [rows]);
  const load = async () => {
    if (!resolvedOrgId) return;
    setLoading(true);
    const { data, error: queryError } = await supabase.from("organization_integrations")
      .select("provider,status").eq("organization_id", resolvedOrgId).eq("provider", "messenger");
    setRows((data ?? []) as Integration[]); setError(queryError ? "No pudimos cargar Messenger." : ""); setLoading(false);
  };
  useEffect(() => { void load(); }, [resolvedOrgId]);
  const connect = async (provider: "messenger") => {
    if (!resolvedOrgId) return;
    setBusy(provider); setError("");
    const { data, error: connectError } = await supabase.functions.invoke("integrations-connect", { body: { organization_id: resolvedOrgId, provider } });
    const url = (data as { url?: string } | null)?.url;
    if (connectError || !url) { setError("No pudimos iniciar la conexión. Inténtalo de nuevo."); setBusy(null); return; }
    window.location.assign(url);
  };
  return <main className="rh-integrations-page">
    <header className="rh-services-header"><div><p className="rh-eyebrow">CANALES</p><h1>Integraciones</h1><p>Conecta los canales donde tus clientes ya te escriben.</p></div><button type="button" className="rh-refresh" onClick={() => void load()} disabled={loading}><RefreshCw />Actualizar</button></header>
    {error ? <div className="rh-service-alert" role="alert">{error}</div> : null}
    <section className="rh-integration-grid" aria-label="Canales de mensajería">
      <WhatsAppConnect organizationId={resolvedOrgId} businessType="referral_hub" canManage={mayStartWhatsAppEmbeddedSignup(membershipRole)} onConnected={() => void load()} />
      {channels.map(({ provider, title, copy, icon: Icon }) => {
      const status = rowMap.get(provider)?.status ?? "disconnected";
      const connected = status === "connected";
      return <article key={provider} className="rh-integration-card"><span className="rh-integration-icon"><Icon /></span><div><span className={connected ? "rh-available-badge" : "rh-off-badge"}>{connected ? <CheckCircle2 /> : null}{connected ? "Conectado" : "Sin conectar"}</span><h2>{title}</h2><p>{copy}</p></div><button type="button" disabled={loading || busy === provider} onClick={() => void connect(provider)}>{busy === provider ? "Abriendo…" : connected ? "Administrar" : "Conectar"}</button></article>;
      })}</section>
  </main>;
}
