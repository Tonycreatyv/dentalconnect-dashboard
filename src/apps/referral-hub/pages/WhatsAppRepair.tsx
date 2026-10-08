import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
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
  expected_app_present?: "PASS" | "FAIL" | "UNKNOWN";
  error?: string;
};

export default function WhatsAppRepair() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RepairResult | null>(null);

  const repair = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    const { data, error: invokeError } = await supabase.functions.invoke("whatsapp-signup", {
      body: {
        action: "subscribe_luis_waba_app",
        organization_id: ORGANIZATION_ID,
      },
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

  const operation = result?.subscription?.operation ?? result?.operation;
  const expectedAppPresent = result?.subscription?.expected_app_present ?? result?.expected_app_present;
  const success = Boolean(result) && !error && (operation === "SUBSCRIBED" || operation === "ALREADY_SUBSCRIBED" || expectedAppPresent === "PASS");

  return (
    <main className="rh-integrations-page">
      <header className="rh-services-header">
        <div>
          <p className="rh-eyebrow">WHATSAPP</p>
          <h1>Reparar webhook</h1>
          <p>Vuelve a suscribir la app de Creatyv al WhatsApp Business Account de Luis sin cambiar Flows, cupones ni routing.</p>
        </div>
      </header>

      <article className="rh-integration-card" style={{ maxWidth: 680 }}>
        <div>
          <h2>Suscripción WABA → Creatyv</h2>
          <p>Usá esta reparación cuando WhatsApp recibe mensajes en el teléfono pero ConeXXion deja de recibirlos en el webhook.</p>
        </div>
        <button type="button" onClick={() => void repair()} disabled={busy}>
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
              <p>Meta reportó la app de Creatyv suscrita al WABA. Probá ahora enviando “Hola” desde otro teléfono.</p>
              <small>Resultado: {operation ?? expectedAppPresent ?? "PASS"}</small>
            </div>
          </div>
        ) : null}

        {result && !success && !error ? (
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify(result, null, 2)}</pre>
        ) : null}

        <Link to="/integrations" className="rh-back-link">Volver a Integraciones</Link>
      </article>
    </main>
  );
}
