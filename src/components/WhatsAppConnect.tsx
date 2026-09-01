import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createMetaEmbeddedSignupAttempt } from "../lib/metaEmbeddedSignupAttempt";
import { supabase } from "../lib/supabaseClient";
import {
  deriveWhatsAppConnectionStatus,
  type WhatsAppConnectionStatus,
} from "../lib/whatsappConnectionState";
import type { MetaEmbeddedSignupCompletion } from "../lib/metaEmbeddedSignupAttempt";

const PUBLIC_APP_URL = import.meta.env.VITE_PUBLIC_APP_URL;
const FB_APP_ID = import.meta.env.VITE_META_APP_ID;
const FB_CONFIG_ID = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID;
const FB_SDK_VERSION = "v21.0";
const META_EMBEDDED_SIGNUP_FEATURE_TYPE = "whatsapp_business_app_onboarding";
const META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION = "3";

type ConnectionStatus =
  | "loading"
  | "connecting"
  | "error"
  | WhatsAppConnectionStatus;
type Props = {
  organizationId: string;
  onConnected?: () => void;
  businessType?: "dental" | "barbershop" | "referral_hub";
  canManage?: boolean;
};
type StatusRow = {
  whatsapp_enabled?: boolean | null;
  whatsapp_phone_number?: string | null;
  whatsapp_display_name?: string | null;
  whatsapp_phone_number_id?: string | null;
  whatsapp_registered?: boolean | null;
  whatsapp_webhooks_subscribed?: boolean | null;
  whatsapp_onboarding_mode?: string | null;
  whatsapp_onboarding_event?: string | null;
  whatsapp_business_app_coexistence_completed?: boolean | null;
  whatsapp_token_expires_at?: string | null;
};
type SafeFunctionFailure = {
  status: number | null;
  code: string;
  message: string;
};
type EmbeddedSignupEventType =
  | "FINISH"
  | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
  | "CANCEL"
  | "ERROR"
  | "OTHER"
  | "NOT_RECEIVED";
type EmbeddedSignupDiagnostics = {
  embedded_signup_opened: boolean;
  fb_login_callback_received: boolean;
  authorization_code_present: boolean;
  embedded_signup_event_received: boolean;
  embedded_signup_event_type: EmbeddedSignupEventType;
  onboarding_mode: "STANDARD" | "COEXISTENCE" | "NOT_DETERMINED";
  business_app_coexistence_completed: boolean;
  waba_id_present: boolean;
  phone_number_id_present: boolean;
  code_and_finish_available: boolean;
  backend_invocation_started: boolean;
  backend_result: "NOT_CALLED" | "SUCCESS" | "FAIL";
  backend_result_classification: string | null;
  connection_refresh_result:
    | "NOT_ATTEMPTED"
    | "CONNECTED"
    | "PENDING_ACTIVATION"
    | "DISCONNECTED"
    | "FAILED";
  // Raw values captured directly off the Meta postMessage event, before any
  // normalization/parsing, so the literal string Meta sent is always visible.
  raw_message_origin: string;
  raw_data_event: string;
  raw_data_version: string;
  raw_waba_id_present: boolean;
  raw_phone_number_id_present: boolean;
};

const INITIAL_EMBEDDED_SIGNUP_DIAGNOSTICS: EmbeddedSignupDiagnostics = {
  embedded_signup_opened: false,
  fb_login_callback_received: false,
  authorization_code_present: false,
  embedded_signup_event_received: false,
  embedded_signup_event_type: "NOT_RECEIVED",
  onboarding_mode: "NOT_DETERMINED",
  business_app_coexistence_completed: false,
  waba_id_present: false,
  phone_number_id_present: false,
  code_and_finish_available: false,
  backend_invocation_started: false,
  backend_result: "NOT_CALLED",
  backend_result_classification: null,
  connection_refresh_result: "NOT_ATTEMPTED",
  raw_message_origin: "",
  raw_data_event: "",
  raw_data_version: "",
  raw_waba_id_present: false,
  raw_phone_number_id_present: false,
};

const SAFE_BACKEND_RESULT_CODES = new Set([
  "authorization_rejected",
  "connection_persistence_failed",
  "invalid_state",
  "meta_assets_missing",
  "missing_code",
  "organization_settings_unavailable",
  "registration_check_failed",
  "registration_failed",
  "replacement_confirmation_required",
  "token_exchange_failed",
  "webhook_subscription_failed",
  "whatsapp_signup_failed",
]);

declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (
          response: { status?: string; authResponse?: { code?: string } },
        ) => void,
        options: Record<string, unknown>,
      ) => void;
    };
  }
}

function loadFacebookSDK() {
  return new Promise<void>((resolve, reject) => {
    if (!PUBLIC_APP_URL || !FB_APP_ID || !FB_CONFIG_ID) {
      return reject(new Error("missing_signup_configuration"));
    }
    if (window.FB) return resolve();
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: FB_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: FB_SDK_VERSION,
      });
      resolve();
    };
    if (document.getElementById("facebook-jssdk")) return;
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("sdk_load_failed"));
    document.body.appendChild(script);
  });
}

const LABELS: Record<ConnectionStatus, string> = {
  loading: "Cargando",
  disconnected: "No conectado",
  connecting: "Conectando",
  pending_verification: "Pendiente de verificación",
  onboarded_pending_activation: "Conectado a Meta",
  connected: "WhatsApp activo",
  error_registration: "Error de registro",
  error_webhook: "Error de webhook",
  token_expired: "Token vencido",
  error: "Error",
};

const SAFE_FAILURE_MESSAGES: Record<string, string> = {
  unauthorized: "Tu sesión no fue aceptada. Inicia sesión nuevamente.",
  organization_membership_required:
    "Tu usuario no pertenece a esta organización.",
  owner_or_admin_required:
    "Solo un propietario o administrador puede conectar WhatsApp.",
  authorization_rejected: "La autorización fue rechazada.",
  organization_forbidden: "La organización solicitada no está autorizada.",
  invalid_origin:
    "Este origen local no está autorizado para iniciar la conexión.",
  missing_configuration:
    "Falta configuración segura del servidor para conectar WhatsApp.",
  state_signing_failed:
    "El servidor no pudo firmar el inicio seguro de la conexión.",
  meta_configuration_failed: "La configuración de Meta no es válida.",
  token_exchange_failed:
    "Meta rechazó la configuración o el código de conexión.",
  meta_assets_missing:
    "Meta no devolvió una cuenta y un número de WhatsApp válidos.",
  registration_check_failed: "Meta no pudo verificar el registro del número.",
  webhook_subscription_failed: "Meta no confirmó la suscripción de mensajes.",
  missing_code:
    "La función publicada no admite todavía el inicio seguro de conexión.",
  invalid_state:
    "El estado seguro es inválido o venció. Inicia la conexión nuevamente.",
  function_or_network_failure:
    "La función de conexión no está disponible en este momento.",
};

async function safeFunctionFailure(
  error: unknown,
  data: unknown,
): Promise<SafeFunctionFailure> {
  const response =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: Response }).context
      : undefined;
  let payload = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  if (response) {
    try {
      const responsePayload = await response.clone().json();
      if (responsePayload && typeof responsePayload === "object") {
        payload = responsePayload as Record<string, unknown>;
      }
    } catch { /* A network or gateway failure may not contain JSON. */ }
  }
  const status = response?.status ?? null;
  const fallbackCode = status === 401
    ? "unauthorized"
    : status === 403
    ? "authorization_rejected"
    : "function_or_network_failure";
  const code =
    typeof payload.error === "string" && /^[a-z0-9_]+$/.test(payload.error)
      ? payload.error
      : fallbackCode;
  return {
    status,
    code,
    message: SAFE_FAILURE_MESSAGES[code] ??
      (status === 401
        ? SAFE_FAILURE_MESSAGES.unauthorized
        : status === 403
        ? "La autorización fue rechazada."
        : "No se pudo iniciar una conexión segura."),
  };
}

function reportSafeFailure(
  stage: "create_state" | "exchange",
  failure: SafeFunctionFailure,
) {
  if (!import.meta.env.DEV) return;
  console.error("[whatsapp-signup] request failed", {
    stage,
    status: failure.status,
    code: failure.code,
  });
}

function safeBackendResultClassification(value: unknown) {
  const code = typeof value === "string" ? value : "";
  return SAFE_BACKEND_RESULT_CODES.has(code) ? code : "unknown_failure";
}

function embeddedSignupEventType(value: unknown): EmbeddedSignupEventType {
  if (
    value === "FINISH" ||
    value === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ||
    value === "CANCEL" ||
    value === "ERROR"
  ) {
    return value;
  }
  return "OTHER";
}

export default function WhatsAppConnect(
  { organizationId, onConnected, businessType = "dental", canManage = true }: Props,
) {
  const [status, setStatus] = useState<ConnectionStatus>("loading");
  const [row, setRow] = useState<StatusRow | null>(null);
  const [error, setError] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [embeddedSignupDiagnostics, setEmbeddedSignupDiagnostics] =
    useState<EmbeddedSignupDiagnostics>(INITIAL_EMBEDDED_SIGNUP_DIAGNOSTICS);
  const connecting = useRef(false);
  const cancelActiveAttempt = useRef<(() => void) | null>(null);

  const loadStatus = useCallback(async (
    options: { preserveStatusOnError?: boolean } = {},
  ) => {
    const result = await supabase.from("org_settings").select(
      "whatsapp_enabled,whatsapp_phone_number,whatsapp_display_name,whatsapp_phone_number_id,whatsapp_registered,whatsapp_webhooks_subscribed,whatsapp_onboarding_mode,whatsapp_onboarding_event,whatsapp_business_app_coexistence_completed,whatsapp_token_expires_at",
    ).eq("organization_id", organizationId).maybeSingle();
    if (result.error) {
      if (!options.preserveStatusOnError) setStatus("error");
      setError("No se pudo consultar la conexión de WhatsApp.");
      return undefined;
    }
    const next = (result.data ?? null) as StatusRow | null;
    setRow(next);
    setStatus(deriveWhatsAppConnectionStatus(next));
    return next;
  }, [organizationId]);

  const loadSdk = useCallback(async () => {
    setSdkReady(false);
    try {
      await loadFacebookSDK();
      setSdkReady(true);
    } catch (sdkError) {
      setError(
        sdkError instanceof Error &&
          sdkError.message === "missing_signup_configuration"
          ? "Falta configurar Meta Embedded Signup para este entorno."
          : "No se pudo cargar Meta Embedded Signup.",
      );
    }
  }, []);

  const retry = useCallback(() => {
    setError("");
    void loadStatus();
    void loadSdk();
  }, [loadSdk, loadStatus]);

  useEffect(() => {
    void loadStatus();
    void loadSdk();
  }, [loadSdk, loadStatus]);
  useEffect(() => () => {
    cancelActiveAttempt.current?.();
    cancelActiveAttempt.current = null;
  }, []);

  const exchange = useCallback(
    async (
      input: {
        code: string;
        state: string;
        wabaId: string;
        phoneNumberId: string;
        replaceExisting: boolean;
        completion: MetaEmbeddedSignupCompletion;
      },
    ) => {
      setEmbeddedSignupDiagnostics((current) => ({
        ...current,
        authorization_code_present: Boolean(input.code),
        waba_id_present: Boolean(input.wabaId),
        phone_number_id_present: Boolean(input.phoneNumberId),
        code_and_finish_available: true,
        backend_invocation_started: true,
        backend_result: "NOT_CALLED",
        backend_result_classification: null,
      }));
      let result;
      try {
        result = await supabase.functions.invoke("whatsapp-signup", {
          body: {
            action: "exchange",
            code: input.code,
            state: input.state,
            waba_id: input.wabaId,
            phone_number_id: input.phoneNumberId,
            replace_existing: input.replaceExisting,
            onboarding_event: input.completion.eventName,
            onboarding_mode: input.completion.onboardingMode,
            session_info_version: input.completion.sessionInfoVersion,
            business_app_coexistence_completed:
              input.completion.businessAppCoexistenceCompleted,
          },
        });
      } catch (invokeError) {
        const failure = await safeFunctionFailure(invokeError, null);
        setEmbeddedSignupDiagnostics((current) => ({
          ...current,
          backend_result: "FAIL",
          backend_result_classification: safeBackendResultClassification(
            failure.code,
          ),
          connection_refresh_result: "NOT_ATTEMPTED",
        }));
        reportSafeFailure("exchange", failure);
        setStatus("error");
        setError("No se pudo completar la conexión.");
        return false;
      }
      const reason = String(result.data?.error ?? "");
      if (result.error || !result.data?.ok) {
        const failure = await safeFunctionFailure(result.error, result.data);
        setEmbeddedSignupDiagnostics((current) => ({
          ...current,
          backend_result: "FAIL",
          backend_result_classification: safeBackendResultClassification(
            result.data?.error ?? failure.code,
          ),
          connection_refresh_result: "DISCONNECTED",
        }));
        reportSafeFailure("exchange", failure);
        if (reason === "replacement_confirmation_required") {
          throw new Error(reason);
        }
        setStatus(
          reason === "registration_failed"
            ? "error_registration"
            : reason === "webhook_subscription_failed"
            ? "error_webhook"
            : "error",
        );
        setError(
          reason === "registration_failed"
            ? "Meta no confirmó el registro del número."
            : reason === "webhook_subscription_failed"
            ? "Meta no confirmó la suscripción de mensajes."
            : "No se pudo completar la conexión.",
        );
        return false;
      }
      setStatus(
        result.data.connection_state === "connected"
          ? "connected"
          : input.completion.onboardingMode === "COEXISTENCE"
          ? "onboarded_pending_activation"
          : "pending_verification",
      );
      setRow((current) => ({
        ...current,
        whatsapp_enabled: result.data.connection_state === "connected",
        whatsapp_phone_number: result.data.phone_number,
        whatsapp_display_name: result.data.display_name,
        whatsapp_phone_number_id: input.phoneNumberId,
        whatsapp_registered: true,
        whatsapp_webhooks_subscribed: true,
        whatsapp_onboarding_mode: input.completion.onboardingMode,
        whatsapp_onboarding_event: input.completion.eventName,
        whatsapp_business_app_coexistence_completed:
          input.completion.businessAppCoexistenceCompleted,
      }));
      setEmbeddedSignupDiagnostics((current) => ({
        ...current,
        backend_result: "SUCCESS",
        backend_result_classification: null,
      }));
      let refreshedRow: StatusRow | null | undefined;
      try {
        refreshedRow = await loadStatus({ preserveStatusOnError: true });
      } catch {
        refreshedRow = undefined;
      }
      setEmbeddedSignupDiagnostics((current) => ({
        ...current,
        connection_refresh_result: refreshedRow === undefined
          ? "FAILED"
          : deriveWhatsAppConnectionStatus(refreshedRow) === "connected"
          ? "CONNECTED"
          : deriveWhatsAppConnectionStatus(refreshedRow) ===
              "onboarded_pending_activation"
          ? "PENDING_ACTIVATION"
          : "DISCONNECTED",
      }));
      window.history.replaceState(
        {},
        "",
        new URL("/integrations", PUBLIC_APP_URL!).toString(),
      );
      onConnected?.();
      return true;
    },
    [loadStatus, onConnected],
  );

  const connect = useCallback(async () => {
    if (!canManage || !sdkReady || connecting.current) return;
    const replaceExisting = Boolean(row?.whatsapp_phone_number_id);
    if (
      replaceExisting &&
      !window.confirm(
        "Ya existe un número conectado. ¿Confirmas que deseas iniciar su reemplazo?",
      )
    ) return;
    connecting.current = true;
    setStatus("connecting");
    setError("");
    setEmbeddedSignupDiagnostics(INITIAL_EMBEDDED_SIGNUP_DIAGNOSTICS);
    const stateResult = await supabase.functions.invoke("whatsapp-signup", {
      body: { action: "create_state" },
    });
    const signupState = String(stateResult.data?.state ?? "");
    if (stateResult.error || !signupState) {
      const failure = await safeFunctionFailure(
        stateResult.error,
        stateResult.data,
      );
      reportSafeFailure("create_state", failure);
      const diagnostic = import.meta.env.DEV
        ? ` (${failure.status ?? "sin estado"}: ${failure.code})`
        : "";
      connecting.current = false;
      setStatus("error");
      setError(`${failure.message}${diagnostic}`);
      return;
    }
    cancelActiveAttempt.current?.();
    let handler = (() => {}) as (event: MessageEvent) => void;
    let cancelAttempt = () => {};
    let attemptTimeout = 0;
    const cleanup = () => {
      window.removeEventListener("message", handler);
      window.clearTimeout(attemptTimeout);
      cancelAttempt();
      if (cancelActiveAttempt.current === cleanup) {
        cancelActiveAttempt.current = null;
      }
    };
    const failAttempt = (message: string) => {
      cleanup();
      connecting.current = false;
      setStatus("error");
      setError(message);
    };
    const attempt = createMetaEmbeddedSignupAttempt((result) => {
      cleanup();
      connecting.current = false;
      setEmbeddedSignupDiagnostics((current) => ({
        ...current,
        authorization_code_present: true,
        waba_id_present: true,
        phone_number_id_present: true,
        code_and_finish_available: true,
        onboarding_mode: result.completion.onboardingMode,
        business_app_coexistence_completed:
          result.completion.businessAppCoexistenceCompleted,
      }));
      void exchange({
        ...result,
        state: signupState,
        replaceExisting,
      });
    }, { sessionInfoVersion: META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION });
    cancelAttempt = attempt.cancel;
    handler = (event: MessageEvent) => {
      if (
        !["https://www.facebook.com", "https://web.facebook.com"].includes(
          event.origin,
        )
      ) return;
      try {
        const data = typeof event.data === "string"
          ? JSON.parse(event.data)
          : event.data;
        if (
          data && typeof data === "object" &&
          (data as { type?: unknown }).type === "WA_EMBEDDED_SIGNUP"
        ) {
          const session = data as {
            event?: unknown;
            version?: unknown;
            data?: { waba_id?: unknown; phone_number_id?: unknown };
          };
          setEmbeddedSignupDiagnostics((current) => ({
            ...current,
            // Raw, pre-normalization evidence of what Meta actually sent.
            raw_message_origin: event.origin,
            raw_data_event: typeof session.event === "string"
              ? session.event
              : "",
            raw_data_version:
              typeof session.version === "string" ||
                typeof session.version === "number"
                ? String(session.version)
                : "",
            raw_waba_id_present: Boolean(session.data?.waba_id),
            raw_phone_number_id_present: Boolean(session.data?.phone_number_id),
            embedded_signup_event_received: true,
            embedded_signup_event_type: embeddedSignupEventType(session.event),
            waba_id_present: Boolean(session.data?.waba_id),
            phone_number_id_present: Boolean(session.data?.phone_number_id),
            onboarding_mode:
              session.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
                ? "COEXISTENCE"
                : session.event === "FINISH" ? "STANDARD" : "NOT_DETERMINED",
            business_app_coexistence_completed:
              session.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          }));
        }
        const result = attempt.acceptEvent(data);
        if (result === "cancel") {
          cleanup();
          connecting.current = false;
          setStatus(deriveWhatsAppConnectionStatus(row));
          setError("Conexión cancelada.");
        } else if (result === "error") {
          failAttempt("Meta reportó un error al completar la conexión.");
        } else if (result === "invalid_finish") {
          failAttempt(
            "Meta no devolvió una cuenta y un número de WhatsApp válidos.",
          );
        }
      } catch { /* Ignore unrelated Meta messages. */ }
    };
    window.addEventListener("message", handler);
    cancelActiveAttempt.current = cleanup;
    attemptTimeout = window.setTimeout(() => {
      failAttempt("La conexión con Meta venció. Inténtalo nuevamente.");
    }, 10 * 60 * 1_000);
    try {
      setEmbeddedSignupDiagnostics((current) => ({
        ...current,
        embedded_signup_opened: true,
      }));
      window.FB.login((response) => {
        setEmbeddedSignupDiagnostics((current) => ({
          ...current,
          fb_login_callback_received: true,
          authorization_code_present: Boolean(response.authResponse?.code),
        }));
        if (response.status !== "connected" || !response.authResponse?.code) {
          cleanup();
          connecting.current = false;
          setStatus(deriveWhatsAppConnectionStatus(row));
          setError("Conexión cancelada o no autorizada.");
          return;
        }
        if (
          !attempt.acceptCode(response.authResponse.code) &&
          cancelActiveAttempt.current === cleanup
        ) {
          failAttempt("Meta no devolvió un código de conexión válido.");
        }
      }, {
        config_id: FB_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        state: signupState,
        extras: {
          setup: {},
          featureType: META_EMBEDDED_SIGNUP_FEATURE_TYPE,
          sessionInfoVersion: META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION,
        },
      });
    } catch {
      failAttempt("No se pudo abrir Meta Embedded Signup.");
    }
  }, [canManage, exchange, row, sdkReady]);

  return (
    <div className="rounded-lg border border-[#272a30] bg-[#101114] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25D366]/10 text-[#70D998]">
            {status === "pending_verification" ||
                status === "onboarded_pending_activation"
              ? <Clock3 />
              : status === "connected"
              ? <CheckCircle2 />
              : status === "connecting" || status === "loading"
              ? <Loader2 className="animate-spin" />
              : <MessageCircle />}
          </div>
          <div>
            <strong className="text-sm text-white">WhatsApp</strong>
            <p className="mt-1 text-xs text-[#7E8C99]">
              {row?.whatsapp_display_name || row?.whatsapp_phone_number ||
                (businessType === "referral_hub"
                  ? "LG Community Network"
                  : "WhatsApp Business")}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-bold text-[#9CAAB8]">
          {LABELS[status]}
        </span>
      </div>
      {error
        ? (
          <p role="alert" className="mt-3 flex gap-2 text-xs text-red-300">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        )
        : null}
      {status === "onboarded_pending_activation"
        ? (
          <p className="mt-3 text-xs text-[#9CAAB8]">
            Pendiente de verificar recepción de mensajes
          </p>
        )
        : null}
      {canManage
        ? (
          <section className="mt-4 rounded-md border border-[#272a30] bg-[#0b0c0e] p-3 text-xs text-[#9CAAB8]">
            <p className="font-semibold text-white">Embedded Signup diagnostics</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <span>Popup opened: {embeddedSignupDiagnostics.embedded_signup_opened ? "YES" : "NO"}</span>
              <span>FB.login callback: {embeddedSignupDiagnostics.fb_login_callback_received ? "YES" : "NO"}</span>
              <span>Authorization code present: {embeddedSignupDiagnostics.authorization_code_present ? "YES" : "NO"}</span>
              <span>Session event: {embeddedSignupDiagnostics.embedded_signup_event_received ? embeddedSignupDiagnostics.embedded_signup_event_type : "NOT_RECEIVED"}</span>
              <span>Onboarding mode: {embeddedSignupDiagnostics.onboarding_mode}</span>
              <span>Business App coexistence: {embeddedSignupDiagnostics.business_app_coexistence_completed ? "YES" : "NO"}</span>
              <span>WABA ID present: {embeddedSignupDiagnostics.waba_id_present ? "YES" : "NO"}</span>
              <span>Phone ID present: {embeddedSignupDiagnostics.phone_number_id_present ? "YES" : "NO"}</span>
              <span>Code + FINISH ready: {embeddedSignupDiagnostics.code_and_finish_available ? "YES" : "NO"}</span>
              <span>Backend invoked: {embeddedSignupDiagnostics.backend_invocation_started ? "YES" : "NO"}</span>
              <span>Backend result: {embeddedSignupDiagnostics.backend_result}</span>
              <span>Backend classification: {embeddedSignupDiagnostics.backend_result_classification ?? "NOT_APPLICABLE"}</span>
              <span>Connection refresh: {embeddedSignupDiagnostics.connection_refresh_result}</span>
              <span>Raw origin: {embeddedSignupDiagnostics.raw_message_origin || "NOT_RECEIVED"}</span>
              <span>Raw event: {embeddedSignupDiagnostics.raw_data_event || "NOT_RECEIVED"}</span>
              <span>Raw version: {embeddedSignupDiagnostics.raw_data_version || "NOT_RECEIVED"}</span>
              <span>Raw WABA ID present: {embeddedSignupDiagnostics.raw_waba_id_present ? "YES" : "NO"}</span>
              <span>Raw Phone ID present: {embeddedSignupDiagnostics.raw_phone_number_id_present ? "YES" : "NO"}</span>
            </div>
          </section>
        )
        : null}
      {!canManage && status !== "connected"
        ? <p className="mt-3 text-xs text-[#7E8C99]">Solo un propietario o administrador puede conectar WhatsApp.</p>
        : null}
      {status === "onboarded_pending_activation"
        ? (
          <div className="mt-4">
            <button
              type="button"
              disabled={!canManage}
              onClick={() => void loadStatus()}
              className="min-h-11 w-full rounded-xl border border-[#3B424C] px-4 text-sm font-bold text-[#DCE5EF] disabled:opacity-50"
            >
              Verificar conexión
            </button>
          </div>
        )
        : status !== "connected"
        ? (
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              disabled={!canManage || !sdkReady || status === "connecting" ||
                status === "loading"}
              onClick={() => void connect()}
              className="min-h-11 w-full rounded-xl bg-[#25D366] px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {status === "connecting"
                ? "Conectando…"
                : row?.whatsapp_phone_number_id
                ? "Reconectar WhatsApp"
                : "Conectar WhatsApp"}
            </button>
            {error
              ? <button type="button" onClick={retry} className="min-h-10 rounded-xl border border-[#3B424C] px-4 text-sm font-semibold text-[#DCE5EF]">Reintentar</button>
              : null}
          </div>
        )
        : (
          <p className="mt-3 text-xs text-[#7E8C99]">
            La desconexión y el cambio de número requieren una reconexión
            confirmada. No se exponen credenciales en este panel.
          </p>
        )}
    </div>
  );
}
