import { AlertTriangle, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";

type RepairResult = {
  ok?: boolean;
  subscription?: {
    operation?: "SUBSCRIBED" | "ALREADY_SUBSCRIBED" | "FAILED";
    post_executed?: boolean;
    meta_post_result?: "SUCCESS" | "NOT_EXECUTED" | "FAILED";
    meta_post_http_status?: number | null;
    expected_app_present?: "PASS" | "FAIL" | "UNKNOWN";
    credential_status?: "EXPIRED" | "PERMISSION_BLOCKED" | "UNKNOWN";
  };
  operation?: "SUBSCRIBED" | "ALREADY_SUBSCRIBED" | "FAILED";
  expected_app_present?: "PASS" | "FAIL" | "UNKNOWN" | boolean;
  error?: string;
};

type DiscoveryResult = {
  ok?: boolean;
  discovery?: {
    token_configured?: boolean;
    found?: boolean;
    organization_id?: string;
    waba_id?: string;
    waba_name?: string | null;
    phone_number_id?: string;
    display_phone_number?: string;
    verified_name?: string | null;
    registration_status?: string | null;
    platform_type?: string | null;
    creatyv_waba_access?: boolean | "PASS" | "FAIL" | "UNKNOWN";
    creatyv_phone_access?: boolean | "PASS" | "FAIL" | "UNKNOWN";
    phone_found_in_waba?: "PASS" | "FAIL" | "UNKNOWN";
    subscribed_apps?: Array<{ id?: string; name?: string }>;
    app_relationship?: "PASS" | "FAIL" | "UNKNOWN";
    credential_status?: "EXPIRED" | "PERMISSION_BLOCKED" | "UNKNOWN";
    recovery_capability?:
      | "ASSETS_AND_CREDENTIAL_SUFFICIENT"
      | "ASSETS_FOUND_FRESH_AUTH_REQUIRED"
      | "ASSETS_NOT_RECOVERABLE"
      | "UNKNOWN";
    failure?: string;
    persisted_waba_id?: string | null;
    persisted_phone_number_id?: string | null;
    expected_app_id?: string;
  };
  error?: string;
};

export default function WhatsAppRepair() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RepairResult | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [checkingDirect, setCheckingDirect] = useState(false);
  const [directError, setDirectError] = useState("");
  const [directResult, setDirectResult] = useState<DiscoveryResult | null>(null);

  const repair = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    const { data, error: invokeError } = await supabase.functions.invoke("whatsapp-webhook-repair", {
      body: { organization_id: ORGANIZATION_ID },
    });
    if (invokeError) {
      setError(invokeError.message || "No pudimos reparar la suscripción de WhatsApp.");
      setBusy(false);
      return;
    }
    const payload = (data ?? {}) as RepairResult;
    setResult(payload);
    if (payload.ok === false || payload.operation === "FAILED" || payload.subscription?.operation === "FAILED") {
      setError(payload.error || "Meta no confirmó la suscripción de la app al WABA.");
    }
    setBusy(false);
  };

  const discoverAssets = async () => {
    setDiscovering(true);
    setDiscoveryError("");
    setDiscoveryResult(null);
    const { data, error: invokeError } = await supabase.functions.invoke("whatsapp-signup", {
      body: { action: "discover_luis_whatsapp_assets" },
    });
    if (invokeError) {
      setDiscoveryError(invokeError.message || "No pudimos consultar los activos de WhatsApp en Meta.");
      setDiscovering(false);
      return;
    }
    const payload = (data ?? {}) as DiscoveryResult;
    setDiscoveryResult(payload);
    if (payload.ok === false && !payload.discovery?.found) {
      setDiscoveryError(payload.discovery?.failure || payload.error || "Meta no encontró el número entre los negocios visibles para el token actual.");
    }
    setDiscovering(false);
  };

  const discoverStoredAsset = async () => {
    setCheckingDirect(true);
    setDirectError("");
    setDirectResult(null);
    const { data, error: invokeError } = await supabase.functions.invoke("whatsapp-signup", {
      body: { action: "discover_luis_whatsapp_assets_direct" },
    });
    if (invokeError) {
      setDirectError(invokeError.message || "No pudimos verificar el activo guardado directamente en Meta.");
      setCheckingDirect(false);
      return;
    }
    const payload = (data ?? {}) as DiscoveryResult;
    setDirectResult(payload);
    if (payload.ok === false && !payload.discovery?.found) {
      setDirectError(payload.error || "Meta no confirmó acceso directo al WABA/Phone ID guardados.");
    }
    setCheckingDirect(false);
  };

  const operation = result?.subscription?.operation ?? result?.operation;
  const expectedAppPresent = result?.subscription?.expected_app_present ?? result?.expected_app_present;
  const success = Boolean(result) && !error && (
    operation === "SUBSCRIBED" ||
    operation === "ALREADY_SUBSCRIBED" ||
    expectedAppPresent === "PASS" ||
    expectedAppPresent === true
  );

  return (
    <main className="rh-integrations-page">
      <header className="rh-services-header">
        <div>
          <p className="rh-eyebrow">WHATSAPP</p>
          <h1>Diagnóstico WhatsApp</h1>
          <p>Verifica la suscripción del webhook y localiza el activo real de WhatsApp de Luis sin cambiar Flows, cupones ni routing.</p>
        </div>
      </header>

      <article className="rh-integration-card" style={{ maxWidth: 680 }}>
        <div>
          <h2>Suscripción WABA → Creatyv</h2>
          <p>Usá esta reparación cuando WhatsApp recibe mensajes en el teléfono pero ConeXXion deja de recibirlos en el webhook.</p>
        </div>
        <button type="button" onClick={() => void repair()} disabled={busy || discovering || checkingDirect}>
          <RefreshCw /> {busy ? "Reparando…" : "Reparar suscripción"}
        </button>

        {error ? (
          <div className="rh-service-alert mt-3" role="alert">
            <AlertTriangle /> {error}
          </div>
        ) : null}

        {success ? (
          <div className="rh-service-alert mt-3" style={{ borderColor: "#9adbbf", background: "#eefaf4" }}>
            <CheckCircle2 />
            <div>
              <strong>Suscripción confirmada.</strong>
              <p>Meta reportó la app de Creatyv suscrita al WABA.</p>
              <small>Resultado: {operation ?? String(expectedAppPresent ?? "PASS")}</small>
            </div>
          </div>
        ) : null}

        <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid #e5e7eb" }} />

        <div>
          <h2>Localizar WABA real</h2>
          <p>Consulta los Business Portfolios visibles para el token actual y busca específicamente el número +1 770-713-7058 entre WABAs propios y compartidos.</p>
        </div>
        <button type="button" onClick={() => void discoverAssets()} disabled={busy || discovering || checkingDirect}>
          <Search /> {discovering ? "Buscando…" : "Descubrir activo real"}
        </button>

        {discoveryError ? (
          <div className="rh-service-alert mt-3" role="alert">
            <AlertTriangle /> {discoveryError}
          </div>
        ) : null}

        {discoveryResult ? (
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify(discoveryResult, null, 2)}</pre>
        ) : null}

        <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid #e5e7eb" }} />

        <div>
          <h2>Verificar activo guardado</h2>
          <p>Consulta directamente el WABA y Phone ID persistidos en ConeXXion. No enumera Business Portfolios y no cambia ninguna configuración.</p>
        </div>
        <button type="button" onClick={() => void discoverStoredAsset()} disabled={busy || discovering || checkingDirect}>
          <Search /> {checkingDirect ? "Verificando…" : "Verificar activo guardado"}
        </button>

        {directError ? (
          <div className="rh-service-alert mt-3" role="alert">
            <AlertTriangle /> {directError}
          </div>
        ) : null}

        {directResult ? (
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify(directResult, null, 2)}</pre>
        ) : null}

        <Link to="/integrations" className="rh-back-link">Volver a Integraciones</Link>
      </article>
    </main>
  );
}
