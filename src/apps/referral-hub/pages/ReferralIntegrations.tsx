import { CheckCircle2, MessageCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import WhatsAppConnect from "../../../components/WhatsAppConnect";
import { supabase } from "../../../lib/supabaseClient";
import { mayStartWhatsAppEmbeddedSignup } from "../../../lib/whatsappConnectionState";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

type Integration = { provider: "messenger"; status: "connected" | "pending" | "error" | "disconnected" };
type SafeMetaReadDiagnostic = {
  classification?: "META_HTTP_ERROR" | "NETWORK_ERROR" | "INVALID_META_RESPONSE";
  http_status?: number;
  meta_error?: { type?: string; code?: number; error_subcode?: number; message?: string };
};
type MetaTestAssetValidation = {
  token_configured?: boolean;
  phone_id_accessible?: "PASS" | "FAIL" | "UNKNOWN";
  display_number_match?: "PASS" | "FAIL" | "UNKNOWN";
  waba_match?: "PASS" | "FAIL" | "UNKNOWN";
  messaging_asset_accessible?: "PASS" | "FAIL" | "UNKNOWN";
  webhook_status?: "PASS" | "FAIL" | "UNKNOWN";
  credential_status?: "EXPIRED" | "PERMISSION_BLOCKED" | "UNKNOWN";
  meta_diagnostics?: Partial<Record<"phone_id" | "waba" | "subscription", SafeMetaReadDiagnostic>>;
  overall?: "PASS" | "FAIL" | "PARTIAL";
};
type MetaTestWabaDiagnostic = {
  before?: "SUBSCRIBED" | "NOT_SUBSCRIBED" | "UNKNOWN";
  app_webhook_status?: "PASS" | "FAIL" | "UNKNOWN";
  callback_url?: "MATCH" | "MISMATCH" | "UNKNOWN";
  messages_subscription?: "PASS" | "FAIL" | "UNKNOWN";
  status?: "PASS" | "PARTIAL" | "FAILED";
  meta_diagnostics?: Partial<Record<"subscribed_apps" | "app_webhook", SafeMetaReadDiagnostic>>;
};
type MetaTestWabaSubscription = {
  before?: "SUBSCRIBED" | "NOT_SUBSCRIBED" | "UNKNOWN";
  after?: "SUBSCRIBED" | "NOT_SUBSCRIBED" | "UNKNOWN";
  operation?: "SUBSCRIBED" | "ALREADY_SUBSCRIBED" | "FAILED";
  app_id_present?: "YES" | "NO" | "UNKNOWN";
  meta_diagnostics?: Record<string, SafeMetaReadDiagnostic>;
};

const REFERRAL_DEMO_ORGANIZATION_ID = "luis-gabriel-referral-hub";
const META_TEST_ASSETS = {
  phone_number_id: "1185864697945379",
  waba_id: "2080644335858568",
  expected_display_number: "+15551807992",
  expected_recipient: "+17707137058",
} as const;
const channels = [
  { provider: "messenger" as const, title: "Messenger", copy: "Mantén tus conversaciones de Facebook en un solo lugar.", icon: MessageCircle },
];

export default function ReferralIntegrations() {
  const { resolvedOrgId, membershipRole } = useReferralOrganization();
  const [rows, setRows] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [metaValidation, setMetaValidation] = useState<MetaTestAssetValidation | null>(null);
  const [validatingMetaTest, setValidatingMetaTest] = useState(false);
  const [metaValidationError, setMetaValidationError] = useState("");
  const [metaDiagnostic, setMetaDiagnostic] = useState<MetaTestWabaDiagnostic | null>(null);
  const [diagnosingMetaTest, setDiagnosingMetaTest] = useState(false);
  const [metaDiagnosticError, setMetaDiagnosticError] = useState("");
  const [metaSubscription, setMetaSubscription] = useState<MetaTestWabaSubscription | null>(null);
  const [subscribingMetaTest, setSubscribingMetaTest] = useState(false);
  const [metaSubscriptionError, setMetaSubscriptionError] = useState("");
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.provider, row])), [rows]);
  const canManageWhatsApp = mayStartWhatsAppEmbeddedSignup(membershipRole);
  const mayValidateMetaTestAssets = canManageWhatsApp && resolvedOrgId === REFERRAL_DEMO_ORGANIZATION_ID;
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
  const validateMetaTestAssets = async () => {
    if (!mayValidateMetaTestAssets) return;
    setValidatingMetaTest(true);
    setMetaValidation(null);
    setMetaValidationError("");
    const { data, error: validationError } = await supabase.functions.invoke("whatsapp-signup", {
      body: {
        action: "validate_test_assets",
        organization_id: REFERRAL_DEMO_ORGANIZATION_ID,
        ...META_TEST_ASSETS,
      },
    });
    const validation = (data as { validation?: MetaTestAssetValidation } | null)?.validation;
    if (validationError || !validation) {
      setMetaValidationError("No pudimos validar el número de prueba. Inténtalo de nuevo.");
    } else {
      setMetaValidation(validation);
    }
    setValidatingMetaTest(false);
  };
  const diagnoseTestWaba = async () => {
    if (!mayValidateMetaTestAssets) return;
    setDiagnosingMetaTest(true);
    setMetaDiagnostic(null);
    setMetaDiagnosticError("");
    const { data, error: diagnosticError } = await supabase.functions.invoke("whatsapp-signup", {
      body: {
        action: "diagnose_test_waba_subscription",
        organization_id: REFERRAL_DEMO_ORGANIZATION_ID,
        waba_id: META_TEST_ASSETS.waba_id,
      },
    });
    const diagnostic = (data as { diagnostic?: MetaTestWabaDiagnostic } | null)?.diagnostic;
    if (diagnosticError || !diagnostic) {
      setMetaDiagnosticError("No pudimos diagnosticar la suscripción del WABA de prueba.");
    } else {
      setMetaDiagnostic(diagnostic);
    }
    setDiagnosingMetaTest(false);
  };
  const subscribeTestWaba = async () => {
    if (!mayValidateMetaTestAssets) return;
    setSubscribingMetaTest(true);
    setMetaSubscription(null);
    setMetaSubscriptionError("");
    const { data, error: subscriptionError } = await supabase.functions.invoke("whatsapp-signup", {
      body: {
        action: "subscribe_test_waba",
        organization_id: REFERRAL_DEMO_ORGANIZATION_ID,
        waba_id: META_TEST_ASSETS.waba_id,
      },
    });
    const subscription = (data as { subscription?: MetaTestWabaSubscription } | null)?.subscription;
    if (subscriptionError || !subscription) {
      setMetaSubscriptionError("No pudimos suscribir el WABA de prueba.");
    } else {
      setMetaSubscription(subscription);
    }
    setSubscribingMetaTest(false);
  };
  return <main className="rh-integrations-page">
    <header className="rh-services-header"><div><p className="rh-eyebrow">CANALES</p><h1>Integraciones</h1><p>Conecta los canales donde tus clientes ya te escriben.</p></div><button type="button" className="rh-refresh" onClick={() => void load()} disabled={loading}><RefreshCw />Actualizar</button></header>
    {error ? <div className="rh-service-alert" role="alert">{error}</div> : null}
    <section className="rh-integration-grid" aria-label="Canales de mensajería">
      <div>
        <WhatsAppConnect organizationId={resolvedOrgId} businessType="referral_hub" canManage={canManageWhatsApp} onConnected={() => void load()} />
        {mayValidateMetaTestAssets ? <article className="rh-integration-card mt-3">
          <div><h2>Validación temporal de Meta</h2><p>Consulta el activo de prueba sin cambiar la configuración ni enviar mensajes.</p></div>
          <button type="button" onClick={() => void validateMetaTestAssets()} disabled={validatingMetaTest}>{validatingMetaTest ? "Validando…" : "Validate Meta test number"}</button>
          <button type="button" className="mt-2" onClick={() => void diagnoseTestWaba()} disabled={diagnosingMetaTest}>{diagnosingMetaTest ? "Diagnosticando…" : "Diagnose test WABA"}</button>
          <button type="button" className="mt-2" onClick={() => void subscribeTestWaba()} disabled={subscribingMetaTest}>{subscribingMetaTest ? "Suscribiendo…" : "Subscribe test WABA"}</button>
          {metaDiagnosticError ? <p className="rh-service-alert mt-3" role="alert">{metaDiagnosticError}</p> : null}
          {metaDiagnostic ? <dl className="mt-3 grid gap-1 text-sm">
            <div><dt className="font-medium">WABA subscribed_apps</dt><dd>{metaDiagnostic.before ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">App-level WhatsApp webhook</dt><dd>{metaDiagnostic.app_webhook_status ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Callback URL</dt><dd>{metaDiagnostic.callback_url ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">messages subscription</dt><dd>{metaDiagnostic.messages_subscription ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Diagnostic status</dt><dd>{metaDiagnostic.status ?? "FAILED"}</dd></div>
          </dl> : null}
          {metaDiagnostic?.meta_diagnostics ? <dl className="mt-3 grid gap-1 text-sm">
            {Object.entries(metaDiagnostic.meta_diagnostics).map(([check, diagnostic]) => <div key={check}>
              <dt className="font-medium">{check}</dt>
              <dd>{diagnostic.classification ?? "UNKNOWN"}{diagnostic.http_status ? ` · HTTP ${diagnostic.http_status}` : ""}{diagnostic.meta_error?.type ? ` · ${diagnostic.meta_error.type}` : ""}{diagnostic.meta_error?.code !== undefined ? ` · code ${diagnostic.meta_error.code}` : ""}{diagnostic.meta_error?.error_subcode !== undefined ? ` · subcode ${diagnostic.meta_error.error_subcode}` : ""}{diagnostic.meta_error?.message ? ` · ${diagnostic.meta_error.message}` : ""}</dd>
            </div>)}
          </dl> : null}
          {metaSubscriptionError ? <p className="rh-service-alert mt-3" role="alert">{metaSubscriptionError}</p> : null}
          {metaSubscription ? <dl className="mt-3 grid gap-1 text-sm">
            <div><dt className="font-medium">Before</dt><dd>{metaSubscription.before ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Meta operation</dt><dd>{metaSubscription.operation ?? "FAILED"}</dd></div>
            <div><dt className="font-medium">After</dt><dd>{metaSubscription.after ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">App ID present</dt><dd>{metaSubscription.app_id_present ?? "UNKNOWN"}</dd></div>
          </dl> : null}
          {metaSubscription?.meta_diagnostics ? <dl className="mt-3 grid gap-1 text-sm">
            {Object.entries(metaSubscription.meta_diagnostics).map(([check, diagnostic]) => <div key={check}>
              <dt className="font-medium">{check}</dt>
              <dd>{diagnostic.classification ?? "UNKNOWN"}{diagnostic.http_status ? ` · HTTP ${diagnostic.http_status}` : ""}{diagnostic.meta_error?.type ? ` · ${diagnostic.meta_error.type}` : ""}{diagnostic.meta_error?.code !== undefined ? ` · code ${diagnostic.meta_error.code}` : ""}{diagnostic.meta_error?.error_subcode !== undefined ? ` · subcode ${diagnostic.meta_error.error_subcode}` : ""}{diagnostic.meta_error?.message ? ` · ${diagnostic.meta_error.message}` : ""}</dd>
            </div>)}
          </dl> : null}
          {metaValidationError ? <p className="rh-service-alert mt-3" role="alert">{metaValidationError}</p> : null}
          {metaValidation ? <dl className="mt-3 grid gap-1 text-sm">
            <div><dt className="font-medium">Token configured</dt><dd>{metaValidation.token_configured ? "PASS" : "FAIL"}</dd></div>
            <div><dt className="font-medium">Phone ID accessible</dt><dd>{metaValidation.phone_id_accessible ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Display number match</dt><dd>{metaValidation.display_number_match ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">WABA match</dt><dd>{metaValidation.waba_match ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Messaging asset accessible</dt><dd>{metaValidation.messaging_asset_accessible ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Webhook/subscription status</dt><dd>{metaValidation.webhook_status ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Credential status</dt><dd>{metaValidation.credential_status ?? "UNKNOWN"}</dd></div>
            <div><dt className="font-medium">Overall result</dt><dd>{metaValidation.overall ?? "UNKNOWN"}</dd></div>
          </dl> : null}
          {metaValidation?.meta_diagnostics ? <dl className="mt-3 grid gap-1 text-sm">
            {Object.entries(metaValidation.meta_diagnostics).map(([check, diagnostic]) => <div key={check}>
              <dt className="font-medium">{check}</dt>
              <dd>{diagnostic.classification ?? "UNKNOWN"}{diagnostic.http_status ? ` · HTTP ${diagnostic.http_status}` : ""}{diagnostic.meta_error?.type ? ` · ${diagnostic.meta_error.type}` : ""}{diagnostic.meta_error?.code !== undefined ? ` · code ${diagnostic.meta_error.code}` : ""}{diagnostic.meta_error?.error_subcode !== undefined ? ` · subcode ${diagnostic.meta_error.error_subcode}` : ""}{diagnostic.meta_error?.message ? ` · ${diagnostic.meta_error.message}` : ""}</dd>
            </div>)}
          </dl> : null}
        </article> : null}
      </div>
      {channels.map(({ provider, title, copy, icon: Icon }) => {
      const status = rowMap.get(provider)?.status ?? "disconnected";
      const connected = status === "connected";
      return <article key={provider} className="rh-integration-card"><span className="rh-integration-icon"><Icon /></span><div><span className={connected ? "rh-available-badge" : "rh-off-badge"}>{connected ? <CheckCircle2 /> : null}{connected ? "Conectado" : "Sin conectar"}</span><h2>{title}</h2><p>{copy}</p></div><button type="button" disabled={loading || busy === provider} onClick={() => void connect(provider)}>{busy === provider ? "Abriendo…" : connected ? "Administrar" : "Conectar"}</button></article>;
      })}</section>
  </main>;
}
