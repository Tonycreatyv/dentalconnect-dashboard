import { AlertTriangle, CheckCircle2, Clock3, Loader2, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const PUBLIC_APP_URL = import.meta.env.VITE_PUBLIC_APP_URL;
const FB_APP_ID = import.meta.env.VITE_META_APP_ID;
const FB_CONFIG_ID = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID;
const FB_SDK_VERSION = "v21.0";

type ConnectionStatus = "loading" | "disconnected" | "connecting" | "pending_verification" | "connected" | "error_registration" | "error_webhook" | "token_expired" | "error";
type Props = { organizationId: string; onConnected?: () => void; businessType?: "dental" | "barbershop" | "referral_hub" };
type StatusRow = { whatsapp_enabled?: boolean; whatsapp_phone_number?: string | null; whatsapp_display_name?: string | null; whatsapp_phone_number_id?: string | null; whatsapp_registered?: boolean; whatsapp_webhooks_subscribed?: boolean; whatsapp_token_expires_at?: string | null };
type SafeFunctionFailure = { status: number | null; code: string; message: string };

declare global { interface Window { fbAsyncInit: () => void; FB: { init: (options: Record<string, unknown>) => void; login: (callback: (response: { status?: string; authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void } } }

function loadFacebookSDK() {
  return new Promise<void>((resolve, reject) => {
    if (!PUBLIC_APP_URL || !FB_APP_ID || !FB_CONFIG_ID) return reject(new Error("missing_signup_configuration"));
    if (window.FB) return resolve();
    window.fbAsyncInit = () => { window.FB.init({ appId: FB_APP_ID, autoLogAppEvents: true, xfbml: false, version: FB_SDK_VERSION }); resolve(); };
    if (document.getElementById("facebook-jssdk")) return;
    const script = document.createElement("script");
    script.id = "facebook-jssdk"; script.src = "https://connect.facebook.net/en_US/sdk.js"; script.async = true; script.defer = true; script.onerror = () => reject(new Error("sdk_load_failed"));
    document.body.appendChild(script);
  });
}

function deriveStatus(row: StatusRow | null): ConnectionStatus {
  if (!row?.whatsapp_phone_number_id) return "disconnected";
  if (row.whatsapp_token_expires_at && new Date(row.whatsapp_token_expires_at).getTime() <= Date.now()) return "token_expired";
  if (!row.whatsapp_registered) return "error_registration";
  if (!row.whatsapp_webhooks_subscribed) return "error_webhook";
  return row.whatsapp_enabled ? "connected" : "pending_verification";
}

const LABELS: Record<ConnectionStatus, string> = { loading: "Cargando", disconnected: "No conectado", connecting: "Conectando", pending_verification: "Pendiente de verificación", connected: "Conectado", error_registration: "Error de registro", error_webhook: "Error de webhook", token_expired: "Token vencido", error: "Error" };

const SAFE_FAILURE_MESSAGES: Record<string, string> = {
  unauthorized: "Tu sesión no fue aceptada. Inicia sesión nuevamente.",
  organization_membership_required: "Tu usuario no pertenece a esta organización.",
  owner_or_admin_required: "Solo un propietario o administrador puede conectar WhatsApp.",
  authorization_rejected: "La autorización fue rechazada.",
  organization_forbidden: "La organización solicitada no está autorizada.",
  invalid_origin: "Este origen local no está autorizado para iniciar la conexión.",
  missing_configuration: "Falta configuración segura del servidor para conectar WhatsApp.",
  state_signing_failed: "El servidor no pudo firmar el inicio seguro de la conexión.",
  meta_configuration_failed: "La configuración de Meta no es válida.",
  token_exchange_failed: "Meta rechazó la configuración o el código de conexión.",
  meta_assets_missing: "Meta no devolvió una cuenta y un número de WhatsApp válidos.",
  registration_check_failed: "Meta no pudo verificar el registro del número.",
  webhook_subscription_failed: "Meta no confirmó la suscripción de mensajes.",
  missing_code: "La función publicada no admite todavía el inicio seguro de conexión.",
  invalid_state: "El estado seguro es inválido o venció. Inicia la conexión nuevamente.",
  function_or_network_failure: "La función de conexión no está disponible en este momento.",
};

async function safeFunctionFailure(error: unknown, data: unknown): Promise<SafeFunctionFailure> {
  const response = typeof error === "object" && error !== null && "context" in error
    ? (error as { context?: Response }).context
    : undefined;
  let payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (response) {
    try {
      const responsePayload = await response.clone().json();
      if (responsePayload && typeof responsePayload === "object") payload = responsePayload as Record<string, unknown>;
    } catch { /* A network or gateway failure may not contain JSON. */ }
  }
  const status = response?.status ?? null;
  const fallbackCode = status === 401 ? "unauthorized" : status === 403 ? "authorization_rejected" : "function_or_network_failure";
  const code = typeof payload.error === "string" && /^[a-z0-9_]+$/.test(payload.error) ? payload.error : fallbackCode;
  return { status, code, message: SAFE_FAILURE_MESSAGES[code] ?? (status === 401 ? SAFE_FAILURE_MESSAGES.unauthorized : status === 403 ? "La autorización fue rechazada." : "No se pudo iniciar una conexión segura.") };
}

function reportSafeFailure(stage: "create_state" | "exchange", failure: SafeFunctionFailure) {
  if (!import.meta.env.DEV) return;
  console.error("[whatsapp-signup] request failed", { stage, status: failure.status, code: failure.code });
}

export default function WhatsAppConnect({ organizationId, onConnected, businessType = "dental" }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("loading");
  const [row, setRow] = useState<StatusRow | null>(null);
  const [error, setError] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const connecting = useRef(false);

  const loadStatus = useCallback(async () => {
    const result = await supabase.from("org_settings").select("whatsapp_enabled,whatsapp_phone_number,whatsapp_display_name,whatsapp_phone_number_id,whatsapp_registered,whatsapp_webhooks_subscribed,whatsapp_token_expires_at").eq("organization_id", organizationId).maybeSingle();
    if (result.error) { setStatus("error"); setError("No se pudo consultar la conexión de WhatsApp."); return; }
    const next = (result.data ?? null) as StatusRow | null; setRow(next); setStatus(deriveStatus(next));
  }, [organizationId]);

  useEffect(() => { void loadStatus(); void loadFacebookSDK().then(() => setSdkReady(true)).catch((sdkError) => { setStatus("error"); setError(sdkError instanceof Error && sdkError.message === "missing_signup_configuration" ? "Falta configurar Meta Embedded Signup para este entorno." : "No se pudo cargar Meta Embedded Signup."); }); }, [loadStatus]);

  const exchange = useCallback(async (input: { code: string; state: string; wabaId: string; phoneNumberId: string; replaceExisting: boolean }) => {
    const result = await supabase.functions.invoke("whatsapp-signup", { body: { action: "exchange", code: input.code, state: input.state, waba_id: input.wabaId, phone_number_id: input.phoneNumberId, replace_existing: input.replaceExisting } });
    const reason = String(result.data?.error ?? "");
    if (result.error || !result.data?.ok) {
      const failure = await safeFunctionFailure(result.error, result.data);
      reportSafeFailure("exchange", failure);
      if (reason === "replacement_confirmation_required") throw new Error(reason);
      setStatus(reason === "registration_failed" ? "error_registration" : reason === "webhook_subscription_failed" ? "error_webhook" : "error");
      setError(reason === "registration_failed" ? "Meta no confirmó el registro del número." : reason === "webhook_subscription_failed" ? "Meta no confirmó la suscripción de mensajes." : "No se pudo completar la conexión.");
      return false;
    }
    setStatus(result.data.connection_state === "connected" ? "connected" : "pending_verification");
    setRow((current) => ({ ...current, whatsapp_enabled: result.data.connection_state === "connected", whatsapp_phone_number: result.data.phone_number, whatsapp_display_name: result.data.display_name, whatsapp_phone_number_id: input.phoneNumberId, whatsapp_registered: true, whatsapp_webhooks_subscribed: true }));
    window.history.replaceState({}, "", new URL("/integrations", PUBLIC_APP_URL!).toString()); onConnected?.(); return true;
  }, [onConnected]);

  const connect = useCallback(async () => {
    if (!sdkReady || connecting.current) return;
    const replaceExisting = Boolean(row?.whatsapp_phone_number_id);
    if (replaceExisting && !window.confirm("Ya existe un número conectado. ¿Confirmas que deseas iniciar su reemplazo?")) return;
    connecting.current = true; setStatus("connecting"); setError("");
    const stateResult = await supabase.functions.invoke("whatsapp-signup", { body: { action: "create_state" } });
    const signupState = String(stateResult.data?.state ?? "");
    if (stateResult.error || !signupState) {
      const failure = await safeFunctionFailure(stateResult.error, stateResult.data);
      reportSafeFailure("create_state", failure);
      const diagnostic = import.meta.env.DEV
        ? ` (${failure.status ?? "sin estado"}: ${failure.code})`
        : "";
      connecting.current = false; setStatus("error"); setError(`${failure.message}${diagnostic}`); return;
    }
    window.FB.login((response) => {
      if (response.status !== "connected" || !response.authResponse?.code) { connecting.current = false; setStatus(deriveStatus(row)); setError("Conexión cancelada o no autorizada."); return; }
      const code = response.authResponse.code; let completed = false;
      const finish = async (wabaId: string, phoneNumberId: string) => {
        if (completed) return; completed = true; window.removeEventListener("message", handler); connecting.current = false;
        await exchange({ code, state: signupState, wabaId, phoneNumberId, replaceExisting });
      };
      const handler = (event: MessageEvent) => { if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return; try { const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; if (data?.type === "WA_EMBEDDED_SIGNUP") void finish(String(data.data?.waba_id ?? ""), String(data.data?.phone_number_id ?? "")); } catch { /* Ignore unrelated Meta messages. */ } };
      window.addEventListener("message", handler); window.setTimeout(() => void finish("", ""), 8_000);
    }, { config_id: FB_CONFIG_ID, response_type: "code", override_default_response_type: true, state: signupState, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } });
  }, [exchange, row, sdkReady]);

  return <div className="rounded-lg border border-[#272a30] bg-[#101114] p-4">
    <div className="flex items-start justify-between gap-3"><div className="flex gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25D366]/10 text-[#70D998]">{status==="pending_verification"?<Clock3/>:status==="connected"?<CheckCircle2/>:status==="connecting"||status==="loading"?<Loader2 className="animate-spin"/>:<MessageCircle/>}</div><div><strong className="text-sm text-white">WhatsApp</strong><p className="mt-1 text-xs text-[#7E8C99]">{row?.whatsapp_display_name || row?.whatsapp_phone_number || (businessType === "referral_hub" ? "LG Community Network" : "WhatsApp Business")}</p></div></div><span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-bold text-[#9CAAB8]">{LABELS[status]}</span></div>
    {error?<p role="alert" className="mt-3 flex gap-2 text-xs text-red-300"><AlertTriangle className="h-4 w-4"/>{error}</p>:null}
    {status!=="connected"?<button type="button" disabled={!sdkReady||status==="connecting"||status==="loading"} onClick={()=>void connect()} className="mt-4 min-h-11 w-full rounded-xl bg-[#25D366] px-4 text-sm font-bold text-white disabled:opacity-50">{status==="connecting"?"Conectando…":row?.whatsapp_phone_number_id?"Reconectar WhatsApp":"Conectar WhatsApp"}</button>:<p className="mt-3 text-xs text-[#7E8C99]">La desconexión y el cambio de número requieren una reconexión confirmada. No se exponen credenciales en este panel.</p>}
  </div>;
}
