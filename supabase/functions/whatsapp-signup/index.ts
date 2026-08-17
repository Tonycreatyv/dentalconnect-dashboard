import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  createSignupState,
  mayManageWhatsApp,
  REFERRAL_HUB_ORGANIZATION_ID,
  verifySignupState,
} from "./contract.ts";
import luisBenefitsFlowDefinition from "../_products/referral-hub/luis-benefits-flow.json" with {
  type: "json",
};
import luisImmigrationFlowDefinition from "../_products/referral-hub/luis-immigration-flow.json" with {
  type: "json",
};
import luisAutoAccidentFlowDefinition from "../_products/referral-hub/luis-auto-accident-flow.json" with {
  type: "json",
};
import luisDuiCriminalFlowDefinition from "../_products/referral-hub/luis-dui-criminal-flow.json" with {
  type: "json",
};

const ALLOWED_ORIGINS = new Set(["https://referral.creatyv.io"]);
const META_TEST_WABA_ID = "2080644335858568";
const META_TEST_PHONE_NUMBER_ID = "1185864697945379";
const LUIS_BENEFITS_TEST_FLOW_NAME = "Luis Benefits TEST";
const LUIS_BENEFITS_TEST_FLOW_ID = "2161490298097845";
const LUIS_IMMIGRATION_TEST_FLOW_ID = "1593418642409687";
const LUIS_COMMERCIAL_PHONE = "17707137058";
const LUIS_WABA_ID = "1423647499608507";
const LUIS_PHONE_NUMBER_ID = "1287679991091560";
const LUIS_META_APP_ID = "2290735921663266";

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://referral.creatyv.io",
    "access-control-allow-headers":
      "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
}
function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}
function text(value: unknown, max = 500) {
  return typeof value === "string" && value.trim().length <= max
    ? value.trim()
    : "";
}

type SignupCompletionMetadata = {
  eventName: "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" | null;
  onboardingMode: "STANDARD" | "COEXISTENCE" | null;
  sessionInfoVersion: string | null;
  businessAppCoexistenceCompleted: boolean;
};

function signupCompletionMetadata(body: Record<string, unknown>): SignupCompletionMetadata {
  const eventName = text(body.onboarding_event, 100);
  const sessionInfoVersion = text(body.session_info_version, 20);
  if (eventName === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
    return {
      eventName,
      onboardingMode: "COEXISTENCE",
      sessionInfoVersion: /^\d{1,3}$/.test(sessionInfoVersion)
        ? sessionInfoVersion
        : null,
      businessAppCoexistenceCompleted: true,
    };
  }
  if (eventName === "FINISH") {
    return {
      eventName,
      onboardingMode: "STANDARD",
      sessionInfoVersion: /^\d{1,3}$/.test(sessionInfoVersion)
        ? sessionInfoVersion
        : null,
      businessAppCoexistenceCompleted: false,
    };
  }
  return {
    eventName: null,
    onboardingMode: null,
    sessionInfoVersion: null,
    businessAppCoexistenceCompleted: false,
  };
}

type MetaOAuthError = {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  fbtrace_id?: unknown;
  trace_id?: unknown;
};
type MetaOAuthDiagnostic = {
  stage: "token_exchange";
  upstream_status: number;
  meta_error_type?: string;
  meta_error_code?: number;
  meta_error_subcode?: number;
  safe_message_category:
    | "redirect_uri_mismatch"
    | "invalid_client_credentials"
    | "code_expired_or_reused"
    | "invalid_authorization_code"
    | "app_configuration_mismatch"
    | "unknown_meta_oauth_error";
  trace_id?: string;
};

function safeMetaType(value: unknown) {
  return typeof value === "string" &&
      /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value)
    ? value
    : undefined;
}
function safeMetaInteger(value: unknown) {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d{1,10}$/.test(value)
    ? Number(value)
    : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}
function safeMetaTrace(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)
    ? value
    : undefined;
}

export function classifyMetaOAuthMessage(
  value: unknown,
): MetaOAuthDiagnostic["safe_message_category"] {
  const message = typeof value === "string" ? value.toLowerCase() : "";
  if (/redirect[ _-]?(uri|url)|redirect uri/.test(message)) {
    return "redirect_uri_mismatch";
  }
  if (
    /invalid (client|app)|client[ _-]?(id|secret)|app secret|client credentials/
      .test(message)
  ) return "invalid_client_credentials";
  if (
    /(authorization )?code.{0,50}(expired|already (been )?used|reused|invalidated)|expired.{0,30}(authorization )?code/
      .test(message)
  ) return "code_expired_or_reused";
  if (
    /invalid.{0,30}(authorization )?code|malformed.{0,30}(authorization )?code/
      .test(message)
  ) return "invalid_authorization_code";
  if (
    /config(uration|_id)|app.{0,30}(configuration|association)|does not belong/
      .test(message)
  ) return "app_configuration_mismatch";
  return "unknown_meta_oauth_error";
}

export function safeMetaOAuthDiagnostic(
  status: number,
  payload: unknown,
): MetaOAuthDiagnostic {
  const providerError =
    payload && typeof payload === "object" && "error" in payload &&
      (payload as { error?: unknown }).error &&
      typeof (payload as { error?: unknown }).error === "object"
      ? (payload as { error: MetaOAuthError }).error
      : {};
  const metaErrorType = safeMetaType(providerError.type);
  const metaErrorCode = safeMetaInteger(providerError.code);
  const metaErrorSubcode = safeMetaInteger(providerError.error_subcode);
  const traceId = safeMetaTrace(providerError.fbtrace_id) ??
    safeMetaTrace(providerError.trace_id);
  return {
    stage: "token_exchange",
    upstream_status: status,
    ...(metaErrorType ? { meta_error_type: metaErrorType } : {}),
    ...(metaErrorCode !== undefined ? { meta_error_code: metaErrorCode } : {}),
    ...(metaErrorSubcode !== undefined
      ? { meta_error_subcode: metaErrorSubcode }
      : {}),
    safe_message_category: classifyMetaOAuthMessage(providerError.message),
    ...(traceId ? { trace_id: traceId } : {}),
  };
}

export function buildMetaTokenUrl(
  graphVersion: string,
  appId: string,
  appSecret: string,
  code: string,
) {
  const tokenUrl = new URL(
    `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
  );
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", code);
  return tokenUrl;
}

type ValidationStatus = "PASS" | "FAIL" | "UNKNOWN";
type MetaCredentialStatus = "EXPIRED" | "PERMISSION_BLOCKED" | "UNKNOWN";
type SafeMetaReadDiagnostic = {
  classification: "META_HTTP_ERROR" | "NETWORK_ERROR" | "INVALID_META_RESPONSE";
  http_status?: number;
  meta_error?: {
    type?: string;
    code?: number;
    error_subcode?: number;
    message?: string;
  };
};
type MetaFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type MetaAssetValidationInput = {
  graphVersion: string;
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  expectedDisplayNumber: string;
  expectedAppId: string;
  expectedRecipient: string;
  fetchFn?: MetaFetch;
};
type WabaSubscriptionStatus = "SUBSCRIBED" | "NOT_SUBSCRIBED" | "UNKNOWN";
type WabaSubscriptionOperation =
  | "SUBSCRIBED"
  | "ALREADY_SUBSCRIBED"
  | "FAILED";
type WabaSubscriptionRead = {
  subscription: WabaSubscriptionStatus;
  diagnostic?: SafeMetaReadDiagnostic;
};
type MetaTestWabaSubscriptionInput = {
  graphVersion: string;
  accessToken: string;
  wabaId: string;
  expectedAppId: string;
  expectedWebhookUrl: string;
  fetchFn?: MetaFetch;
};
type MetaTestWabaInspection = {
  before: WabaSubscriptionStatus;
  app_webhook_status: ValidationStatus;
  callback_url: "MATCH" | "MISMATCH" | "UNKNOWN";
  messages_subscription: ValidationStatus;
  status: "PASS" | "FAILED" | "PARTIAL";
  error?: "subscription_status_unavailable" | "app_subscription_unavailable";
  upstream_status?: number;
  meta_diagnostics?: Partial<Record<"subscribed_apps" | "app_webhook", SafeMetaReadDiagnostic>>;
};
type LuisWabaAppSubscriptionInput = {
  graphVersion: string;
  accessToken: string;
  wabaId: string;
  expectedAppId: string;
  fetchFn?: MetaFetch;
};
type LuisWabaAppSubscription = {
  operation: "SUBSCRIBED" | "ALREADY_SUBSCRIBED" | "FAILED";
  post_executed: boolean;
  meta_post_result: "SUCCESS" | "NOT_EXECUTED" | "FAILED";
  meta_post_http_status: number | null;
  subscribed_apps: Array<{ id: string; name?: string }>;
  expected_app_present: ValidationStatus;
  credential_status: MetaCredentialStatus;
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type LuisStoredTokenDebugInput = {
  graphVersion: string;
  accessToken: string;
  appId: string;
  appSecret: string;
  expectedWabaId: string;
  expectedPhoneNumberId: string;
  fetchFn?: MetaFetch;
};
type LuisStoredTokenDebug = {
  token_configured: true;
  is_valid: boolean | null;
  app_id: string | null;
  application: string | null;
  token_type: string | null;
  issued_at: number | null;
  expires_at: number | null;
  scopes: string[];
  granular_scopes: Array<{ permission: string; target_ids: string[] }>;
  token_matches_expected_app: boolean | null;
  has_whatsapp_business_management: boolean;
  has_whatsapp_business_messaging: boolean;
  waba_1423647499608507_granular_access: ValidationStatus;
  phone_1287679991091560_granular_access: ValidationStatus;
  credential_status: MetaCredentialStatus;
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type LuisWhatsAppAssetDiscoveryInput = {
  graphVersion: string;
  accessToken: string;
  expectedDisplayNumber: string;
  expectedAppId: string;
  fetchFn?: MetaFetch;
};
type LuisWhatsAppAssetDiscoveryFailure =
  | "INSUFFICIENT_TOKEN_SCOPE"
  | "NO_SHARED_WABA_VISIBLE"
  | "PHONE_NOT_FOUND"
  | "META_PERMISSION_BLOCKED"
  | "UNKNOWN";
type LuisWhatsAppAssetDiscovery = {
  found: boolean;
  organization_id: typeof REFERRAL_HUB_ORGANIZATION_ID;
  waba_id?: string;
  waba_name?: string | null;
  phone_number_id?: string;
  display_phone_number?: string;
  verified_name?: string | null;
  registration_status?: string | null;
  platform_type?: string | null;
  creatyv_waba_access: boolean | "UNKNOWN";
  creatyv_phone_access: boolean | "UNKNOWN";
  app_relationship: ValidationStatus;
  credential_status: MetaCredentialStatus;
  recovery_capability:
    | "ASSETS_AND_CREDENTIAL_SUFFICIENT"
    | "ASSETS_FOUND_FRESH_AUTH_REQUIRED"
    | "ASSETS_NOT_RECOVERABLE"
    | "UNKNOWN";
  failure?: LuisWhatsAppAssetDiscoveryFailure;
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type LuisWhatsAppDirectAssetDiscoveryInput = {
  graphVersion: string;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  expectedAppId: string;
  fetchFn?: MetaFetch;
};
type LuisWhatsAppDirectAssetDiscovery = {
  found: boolean;
  organization_id: typeof REFERRAL_HUB_ORGANIZATION_ID;
  persisted_waba_id: string | null;
  persisted_phone_number_id: string | null;
  expected_app_id: string;
  subscribed_apps: Array<{ id: string; name?: string }>;
  display_phone_number: string | null;
  verified_name: string | null;
  registration_status: string | null;
  code_verification_status: string | null;
  platform_type: string | null;
  phone_found_in_waba: ValidationStatus;
  creatyv_phone_access: ValidationStatus;
  creatyv_waba_access: ValidationStatus;
  app_relationship: ValidationStatus;
  credential_status: MetaCredentialStatus;
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type WhatsAppActivationInspectionInput = {
  graphVersion: string;
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  fetchFn?: MetaFetch;
};
type WhatsAppActivationInspection = {
  phone_number_id: string;
  display_phone_number: string | null;
  meta_status: string | null;
  phone_access: boolean;
  waba_relationship: ValidationStatus;
  credential_status: MetaCredentialStatus;
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type LuisBusinessAppRegistrationInput = {
  graphVersion: string;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  pin: string;
  fetchFn?: MetaFetch;
};
type LuisBusinessAppRegistrationResult = {
  organization_id: typeof REFERRAL_HUB_ORGANIZATION_ID;
  waba_id: typeof LUIS_WABA_ID;
  phone_number_id: typeof LUIS_PHONE_NUMBER_ID;
  phone_access: ValidationStatus;
  waba_access: ValidationStatus;
  phone_found_in_waba: ValidationStatus;
  code_verification_status: string | null;
  meta_status_before: string | null;
  meta_status_after: string | null;
  platform_type: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  already_connected: boolean;
  registration_attempted: boolean;
  registration_accepted: boolean;
  registration_http_status: number | null;
  activation_complete: boolean;
  error?:
    | "registration_preflight_failed"
    | "registration_waiting_for_meta"
    | "registration_rejected"
    | "registration_verification_failed";
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type LuisBenefitsTestFlowInput = {
  graphVersion: string;
  accessToken: string;
  fetchFn?: MetaFetch;
};
type SafeFlowValidationError = {
  error?: string;
  error_type?: string;
  message?: string;
  line_start?: number;
  line_end?: number;
  column_start?: number;
  column_end?: number;
};
type LuisBenefitsTestFlowResult = {
  test_waba_id: typeof META_TEST_WABA_ID;
  test_phone_number_id: typeof META_TEST_PHONE_NUMBER_ID;
  graph_api_version: string;
  flow_id: string | null;
  flow_name: typeof LUIS_BENEFITS_TEST_FLOW_NAME;
  flow_status: string | null;
  json_version: string;
  json_uploaded: boolean;
  meta_accepted: boolean;
  validation_errors: SafeFlowValidationError[];
  validation_warnings: SafeFlowValidationError[];
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type LuisLegalTestFlowDefinition = {
  name: "Luis Immigration TEST" | "Luis Auto Accident TEST" | "Luis DUI Criminal TEST";
  definition: Record<string, unknown>;
};
type LuisLegalTestFlowResult = {
  test_waba_id: typeof META_TEST_WABA_ID;
  test_phone_number_id: typeof META_TEST_PHONE_NUMBER_ID;
  graph_api_version: string;
  flow_name: LuisLegalTestFlowDefinition["name"];
  flow_id: string | null;
  flow_status: string | null;
  json_version: string;
  json_uploaded: boolean;
  meta_accepted: boolean;
  validation_errors: SafeFlowValidationError[];
  validation_warnings: SafeFlowValidationError[];
  meta_diagnostic?: SafeMetaReadDiagnostic;
};
type LuisTestFlowAccessInput = {
  graphVersion: string;
  accessToken: string;
  fetchFn?: MetaFetch;
};
type LuisTestFlowAccessResult = {
  id: string;
  http_status: number | null;
  accessible: boolean;
  name: string | null;
  status: string | null;
  categories: string[];
  validation_errors: SafeFlowValidationError[];
  health_status: string | null;
  availability: string | boolean | null;
  owning_waba_id: string | null;
  test_waba_membership: ValidationStatus;
  eligible_for_test_draft_send: ValidationStatus;
  meta_diagnostic?: SafeMetaReadDiagnostic;
  optional_metadata_diagnostic?: SafeMetaReadDiagnostic;
};

function normalizedPhone(value: unknown) {
  return text(value, 100).replace(/\D/g, "");
}

function safeMetaGraphMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const sanitized = value.trim()
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(?:bearer|authorization|access[ _-]?token|token)\b\s*[:=]?\s*\S+/gi, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\b\d{9,}\b/g, "[redacted-id]")
    .replace(/\b\d{6}\b/g, "[redacted-pin]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  return sanitized || undefined;
}

export function safeMetaReadDiagnostic(
  status: number,
  payload: unknown,
): SafeMetaReadDiagnostic {
  const error = payload && typeof payload === "object" && "error" in payload &&
      (payload as { error?: unknown }).error &&
      typeof (payload as { error?: unknown }).error === "object"
    ? (payload as { error: MetaOAuthError }).error
    : {};
  const type = safeMetaType(error.type);
  const code = safeMetaInteger(error.code);
  const errorSubcode = safeMetaInteger(error.error_subcode);
  const message = safeMetaGraphMessage(error.message);
  return {
    classification: "META_HTTP_ERROR",
    http_status: status,
    ...(type || code !== undefined || errorSubcode !== undefined || message
      ? {
        meta_error: {
          ...(type ? { type } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(errorSubcode !== undefined ? { error_subcode: errorSubcode } : {}),
          ...(message ? { message } : {}),
        },
      }
      : {}),
  };
}

function networkMetaReadDiagnostic(): SafeMetaReadDiagnostic {
  return { classification: "NETWORK_ERROR" };
}

function invalidMetaResponseDiagnostic(status?: number): SafeMetaReadDiagnostic {
  return {
    classification: "INVALID_META_RESPONSE",
    ...(status !== undefined ? { http_status: status } : {}),
  };
}

function credentialStatusFromDiagnostics(
  diagnostics: Array<SafeMetaReadDiagnostic | undefined>,
): MetaCredentialStatus {
  for (const diagnostic of diagnostics) {
    const error = diagnostic?.meta_error;
    const message = error?.message?.toLowerCase() ?? "";
    if (error?.code === 190 && /expired/.test(message)) return "EXPIRED";
    if (
      /permission|not authorized|access denied|insufficient scope/.test(message) ||
      error?.code === 10 || error?.code === 200
    ) return "PERMISSION_BLOCKED";
  }
  return "UNKNOWN";
}

async function readMetaJson(response: Response) {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object"
      ? { payload: payload as Record<string, unknown> }
      : { diagnostic: invalidMetaResponseDiagnostic(response.status) };
  } catch {
    return { diagnostic: invalidMetaResponseDiagnostic(response.status) };
  }
}

function safeFlowValidationErrors(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const item = entry && typeof entry === "object"
        ? entry as Record<string, unknown>
        : null;
      if (!item) return [];
      const error = safeMetaType(item.error);
      const errorType = safeMetaType(item.error_type);
      const message = safeMetaGraphMessage(item.message);
      const lineStart = safeMetaInteger(item.line_start);
      const lineEnd = safeMetaInteger(item.line_end);
      const columnStart = safeMetaInteger(item.column_start);
      const columnEnd = safeMetaInteger(item.column_end);
      return (error || errorType || message || lineStart !== undefined ||
          lineEnd !== undefined || columnStart !== undefined ||
          columnEnd !== undefined)
        ? [{
          ...(error ? { error } : {}),
          ...(errorType ? { error_type: errorType } : {}),
          ...(message ? { message } : {}),
          ...(lineStart !== undefined ? { line_start: lineStart } : {}),
          ...(lineEnd !== undefined ? { line_end: lineEnd } : {}),
          ...(columnStart !== undefined ? { column_start: columnStart } : {}),
          ...(columnEnd !== undefined ? { column_end: columnEnd } : {}),
        }] : [];
    }).slice(0, 50)
    : [];
}

function luisBenefitsFlowJson() {
  return JSON.stringify(luisBenefitsFlowDefinition);
}

function luisBenefitsTestFlowFailure(
  input: LuisBenefitsTestFlowInput,
  diagnostic: SafeMetaReadDiagnostic,
  flowId: string | null = null,
  jsonUploaded = false,
  validationErrors: SafeFlowValidationError[] = [],
): LuisBenefitsTestFlowResult {
  return {
    test_waba_id: META_TEST_WABA_ID,
    test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
    graph_api_version: input.graphVersion,
    flow_id: flowId,
    flow_name: LUIS_BENEFITS_TEST_FLOW_NAME,
    flow_status: null,
    json_version: text((luisBenefitsFlowDefinition as Record<string, unknown>).version, 20),
    json_uploaded: jsonUploaded,
    meta_accepted: false,
    validation_errors: validationErrors,
    validation_warnings: [],
    meta_diagnostic: diagnostic,
  };
}

async function uploadAndReadLuisBenefitsTestFlow(
  input: LuisBenefitsTestFlowInput,
  flowId: string,
): Promise<LuisBenefitsTestFlowResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const headers = { Authorization: `Bearer ${input.accessToken}` };
  try {
    const uploadBody = new FormData();
    uploadBody.set("name", "flow.json");
    uploadBody.set("asset_type", "FLOW_JSON");
    uploadBody.set(
      "file",
      new Blob([luisBenefitsFlowJson()], { type: "application/json" }),
      "flow.json",
    );
    const uploadResponse = await fetchFn(
      graphUrl(`${encodeURIComponent(flowId)}/assets`),
      { method: "POST", headers, body: uploadBody },
    );
    const uploadResult = await readMetaJson(uploadResponse);
    const validationErrors = safeFlowValidationErrors(
      uploadResult.payload?.validation_errors,
    );
    const validationWarnings = safeFlowValidationErrors(
      uploadResult.payload?.validation_warnings,
    );
    if (!uploadResponse.ok || uploadResult.diagnostic ||
      uploadResult.payload?.success !== true || validationErrors.length > 0 ||
      validationWarnings.length > 0) {
      const failure = luisBenefitsTestFlowFailure(
        input,
        !uploadResponse.ok
          ? safeMetaReadDiagnostic(uploadResponse.status, uploadResult.payload)
          : uploadResult.diagnostic ?? invalidMetaResponseDiagnostic(uploadResponse.status),
        flowId,
        uploadResponse.ok && !uploadResult.diagnostic,
        validationErrors,
      );
      return { ...failure, validation_warnings: validationWarnings };
    }

    const readResponse = await fetchFn(
      graphUrl(`${encodeURIComponent(flowId)}?fields=id,name,status,categories`),
      { headers },
    );
    const readResult = await readMetaJson(readResponse);
    if (!readResponse.ok || readResult.diagnostic) {
      const failure = luisBenefitsTestFlowFailure(
        input,
        !readResponse.ok
          ? safeMetaReadDiagnostic(readResponse.status, readResult.payload)
          : readResult.diagnostic ?? invalidMetaResponseDiagnostic(readResponse.status),
        flowId,
        true,
      );
      return { ...failure, validation_warnings: validationWarnings };
    }
    if (text(readResult.payload?.id, 100) !== flowId) {
      return luisBenefitsTestFlowFailure(
        input,
        invalidMetaResponseDiagnostic(readResponse.status),
        flowId,
        true,
      );
    }
    return {
      test_waba_id: META_TEST_WABA_ID,
      test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
      graph_api_version: input.graphVersion,
      flow_id: flowId,
      flow_name: LUIS_BENEFITS_TEST_FLOW_NAME,
      flow_status: text(readResult.payload?.status, 100) || null,
      json_version: text(
        (luisBenefitsFlowDefinition as Record<string, unknown>).version,
        20,
      ),
      json_uploaded: true,
      meta_accepted: true,
      validation_errors: [],
      validation_warnings: validationWarnings,
    };
  } catch {
    return luisBenefitsTestFlowFailure(
      input,
      networkMetaReadDiagnostic(),
      flowId,
    );
  }
}

// This path only resumes the one hard-coded Flow created on the test WABA. It
// deliberately has no WABA Flow-creation request and cannot reach Luis assets.
export async function resumeLuisBenefitsTestFlow(
  input: LuisBenefitsTestFlowInput,
): Promise<LuisBenefitsTestFlowResult> {
  return await uploadAndReadLuisBenefitsTestFlow(
    input,
    LUIS_BENEFITS_TEST_FLOW_ID,
  );
}

function safeMetaFlowCategories(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const category = safeMetaType(entry);
      return category ? [category] : [];
    }).slice(0, 20)
    : [];
}

function safeMetaFlowAvailability(value: unknown): string | boolean | null {
  if (typeof value === "boolean") return value;
  return safeMetaType(value) ?? null;
}

function safeMetaFlowWabaId(value: unknown): string | null {
  if (typeof value === "string" && /^\d{1,30}$/.test(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = text((value as Record<string, unknown>).id, 100);
  return /^\d{1,30}$/.test(id) ? id : null;
}

/**
 * Read-only comparison for the two hard-coded Luis TEST Flows. The client
 * cannot supply any Meta identity, Flow identity, or credential.
 */
export async function inspectLuisTestFlowAccess(
  input: LuisTestFlowAccessInput,
): Promise<{ test_waba_id: typeof META_TEST_WABA_ID; test_phone_number_id: typeof META_TEST_PHONE_NUMBER_ID; graph_api_version: string; flows: LuisTestFlowAccessResult[] }> {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const headers = { Authorization: `Bearer ${input.accessToken}` };
  const flowIds = [LUIS_IMMIGRATION_TEST_FLOW_ID, LUIS_BENEFITS_TEST_FLOW_ID];
  const memberships = new Map<string, ValidationStatus>();
  let membershipDiagnostic: SafeMetaReadDiagnostic | undefined;
  try {
    const response = await fetchFn(
      graphUrl(`${META_TEST_WABA_ID}/flows?fields=id&limit=100`),
      { headers },
    );
    const result = await readMetaJson(response);
    if (!response.ok || result.diagnostic || !Array.isArray(result.payload?.data)) {
      membershipDiagnostic = !response.ok
        ? safeMetaReadDiagnostic(response.status, result.payload)
        : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status);
    } else {
      const ids = new Set(result.payload.data.flatMap((entry: unknown) => {
        const id = entry && typeof entry === "object"
          ? text((entry as Record<string, unknown>).id, 100)
          : "";
        return id ? [id] : [];
      }));
      for (const id of flowIds) memberships.set(id, ids.has(id) ? "PASS" : "FAIL");
    }
  } catch {
    membershipDiagnostic = networkMetaReadDiagnostic();
  }

  const flows = await Promise.all(flowIds.map(async (id): Promise<LuisTestFlowAccessResult> => {
    let response: Response;
    let result: Awaited<ReturnType<typeof readMetaJson>>;
    try {
      response = await fetchFn(
        graphUrl(`${encodeURIComponent(id)}?fields=id,name,status,categories,validation_errors`),
        { headers },
      );
      result = await readMetaJson(response);
    } catch {
      return {
        id,
        http_status: null,
        accessible: false,
        name: null,
        status: null,
        categories: [],
        validation_errors: [],
        health_status: null,
        availability: null,
        owning_waba_id: null,
        test_waba_membership: "UNKNOWN",
        eligible_for_test_draft_send: "UNKNOWN",
        meta_diagnostic: networkMetaReadDiagnostic(),
      };
    }
    const membership = memberships.get(id) ?? "UNKNOWN";
    if (!response.ok || result.diagnostic || text(result.payload?.id, 100) !== id) {
      const diagnostic = !response.ok
        ? safeMetaReadDiagnostic(response.status, result.payload)
        : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status);
      return {
        id,
        http_status: response.status,
        accessible: false,
        name: null,
        status: null,
        categories: [],
        validation_errors: [],
        health_status: null,
        availability: null,
        owning_waba_id: null,
        test_waba_membership: membership,
        eligible_for_test_draft_send: "FAIL",
        meta_diagnostic: diagnostic,
      };
    }
    let optional: Record<string, unknown> | undefined;
    let optionalDiagnostic: SafeMetaReadDiagnostic | undefined;
    try {
      const optionalResponse = await fetchFn(
        graphUrl(`${encodeURIComponent(id)}?fields=health_status,availability,whatsapp_business_account`),
        { headers },
      );
      const optionalResult = await readMetaJson(optionalResponse);
      if (optionalResponse.ok && !optionalResult.diagnostic) optional = optionalResult.payload;
      else optionalDiagnostic = !optionalResponse.ok
        ? safeMetaReadDiagnostic(optionalResponse.status, optionalResult.payload)
        : optionalResult.diagnostic ?? invalidMetaResponseDiagnostic(optionalResponse.status);
    } catch {
      optionalDiagnostic = networkMetaReadDiagnostic();
    }
    const status = text(result.payload?.status, 100) || null;
    const eligible = membershipDiagnostic
      ? "UNKNOWN"
      : membership === "PASS" && status === "DRAFT" ? "PASS" : "FAIL";
    return {
      id,
      http_status: response.status,
      accessible: true,
      name: text(result.payload?.name, 160) || null,
      status,
      categories: safeMetaFlowCategories(result.payload?.categories),
      validation_errors: safeFlowValidationErrors(result.payload?.validation_errors),
      health_status: safeMetaType(optional?.health_status) ?? null,
      availability: safeMetaFlowAvailability(optional?.availability),
      owning_waba_id: safeMetaFlowWabaId(optional?.whatsapp_business_account),
      test_waba_membership: membership,
      eligible_for_test_draft_send: eligible,
      ...(optionalDiagnostic ? { optional_metadata_diagnostic: optionalDiagnostic } : {}),
    };
  }));
  return {
    test_waba_id: META_TEST_WABA_ID,
    test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
    graph_api_version: input.graphVersion,
    flows,
  };
}

const LUIS_LEGAL_TEST_FLOW_DEFINITIONS: readonly LuisLegalTestFlowDefinition[] = [
  { name: "Luis Immigration TEST", definition: luisImmigrationFlowDefinition },
  { name: "Luis Auto Accident TEST", definition: luisAutoAccidentFlowDefinition },
  { name: "Luis DUI Criminal TEST", definition: luisDuiCriminalFlowDefinition },
];

function legalTestFlowFailure(
  input: LuisBenefitsTestFlowInput,
  definition: LuisLegalTestFlowDefinition,
  diagnostic: SafeMetaReadDiagnostic,
  flowId: string | null = null,
  jsonUploaded = false,
  validationErrors: SafeFlowValidationError[] = [],
): LuisLegalTestFlowResult {
  return {
    test_waba_id: META_TEST_WABA_ID,
    test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
    graph_api_version: input.graphVersion,
    flow_name: definition.name,
    flow_id: flowId,
    flow_status: null,
    json_version: text(definition.definition.version, 20),
    json_uploaded: jsonUploaded,
    meta_accepted: false,
    validation_errors: validationErrors,
    validation_warnings: [],
    meta_diagnostic: diagnostic,
  };
}

async function createLuisLegalTestFlow(
  input: LuisBenefitsTestFlowInput,
  definition: LuisLegalTestFlowDefinition,
  existingFlowId?: string,
): Promise<LuisLegalTestFlowResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const headers = { Authorization: `Bearer ${input.accessToken}` };
  let flowId: string | null = existingFlowId ?? null;
  try {
    if (!flowId) {
      const createBody = new FormData();
      createBody.set("name", definition.name);
      createBody.set("categories", JSON.stringify(["OTHER"]));
      const createResponse = await fetchFn(
        graphUrl(`${META_TEST_WABA_ID}/flows`),
        { method: "POST", headers, body: createBody },
      );
      const createResult = await readMetaJson(createResponse);
      flowId = text(createResult.payload?.id, 100) || null;
      if (!createResponse.ok || createResult.diagnostic || !flowId) {
        return legalTestFlowFailure(
          input,
          definition,
          !createResponse.ok
            ? safeMetaReadDiagnostic(createResponse.status, createResult.payload)
            : createResult.diagnostic ?? invalidMetaResponseDiagnostic(createResponse.status),
        );
      }
    }
    const uploadBody = new FormData();
    uploadBody.set("name", "flow.json");
    uploadBody.set("asset_type", "FLOW_JSON");
    uploadBody.set(
      "file",
      new Blob([JSON.stringify(definition.definition)], { type: "application/json" }),
      "flow.json",
    );
    const uploadResponse = await fetchFn(
      graphUrl(`${encodeURIComponent(flowId)}/assets`),
      { method: "POST", headers, body: uploadBody },
    );
    const uploadResult = await readMetaJson(uploadResponse);
    const validationErrors = safeFlowValidationErrors(uploadResult.payload?.validation_errors);
    const validationWarnings = safeFlowValidationErrors(uploadResult.payload?.validation_warnings);
    if (!uploadResponse.ok || uploadResult.diagnostic ||
      uploadResult.payload?.success !== true || validationErrors.length > 0 ||
      validationWarnings.length > 0) {
      const failure = legalTestFlowFailure(
        input,
        definition,
        !uploadResponse.ok
          ? safeMetaReadDiagnostic(uploadResponse.status, uploadResult.payload)
          : uploadResult.diagnostic ?? invalidMetaResponseDiagnostic(uploadResponse.status),
        flowId,
        uploadResponse.ok && !uploadResult.diagnostic,
        validationErrors,
      );
      return { ...failure, validation_warnings: validationWarnings };
    }
    const readResponse = await fetchFn(
      graphUrl(`${encodeURIComponent(flowId)}?fields=id,name,status,categories`),
      { headers },
    );
    const readResult = await readMetaJson(readResponse);
    if (!readResponse.ok || readResult.diagnostic ||
      text(readResult.payload?.id, 100) !== flowId) {
      const failure = legalTestFlowFailure(
        input,
        definition,
        !readResponse.ok
          ? safeMetaReadDiagnostic(readResponse.status, readResult.payload)
          : readResult.diagnostic ?? invalidMetaResponseDiagnostic(readResponse.status),
        flowId,
        true,
      );
      return { ...failure, validation_warnings: validationWarnings };
    }
    return {
      test_waba_id: META_TEST_WABA_ID,
      test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
      graph_api_version: input.graphVersion,
      flow_name: definition.name,
      flow_id: flowId,
      flow_status: text(readResult.payload?.status, 100) || null,
      json_version: text(definition.definition.version, 20),
      json_uploaded: true,
      meta_accepted: true,
      validation_errors: [],
      validation_warnings: validationWarnings,
    };
  } catch {
    return legalTestFlowFailure(input, definition, networkMetaReadDiagnostic(), flowId);
  }
}

// Creates the three explicitly approved legal test Flows sequentially. A failed
// creation or validation halts the sequence before the next Flow is created.
export async function createLuisLegalTestFlows(
  input: LuisBenefitsTestFlowInput,
) {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const existingIds = new Map<string, string>();
  try {
    const response = await fetchFn(
      graphUrl(`${META_TEST_WABA_ID}/flows?fields=id,name,status&limit=100`),
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );
    const result = await readMetaJson(response);
    if (!response.ok || result.diagnostic || !Array.isArray(result.payload?.data)) {
      return [legalTestFlowFailure(
        input,
        LUIS_LEGAL_TEST_FLOW_DEFINITIONS[0],
        !response.ok
          ? safeMetaReadDiagnostic(response.status, result.payload)
          : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status),
      )];
    }
    for (const row of result.payload.data) {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : null;
      const id = text(item?.id, 100);
      const name = text(item?.name, 160);
      const status = text(item?.status, 32).toUpperCase();
      if (id && status === "DRAFT") existingIds.set(name, id);
    }
  } catch {
    return [legalTestFlowFailure(
      input,
      LUIS_LEGAL_TEST_FLOW_DEFINITIONS[0],
      networkMetaReadDiagnostic(),
    )];
  }
  const flows: LuisLegalTestFlowResult[] = [];
  for (const definition of LUIS_LEGAL_TEST_FLOW_DEFINITIONS) {
    const flow = await createLuisLegalTestFlow(
      input,
      definition,
      existingIds.get(definition.name),
    );
    flows.push(flow);
    if (!flow.meta_accepted) break;
  }
  return flows;
}

// This is intentionally a narrowly scoped, test-only mutation. It can only
// create the approved static Luis Benefits Flow on the hard-coded Meta test WABA.
// It has no path to publish, send, register, subscribe, or reference Luis assets.
export async function createLuisBenefitsTestFlow(
  input: LuisBenefitsTestFlowInput,
): Promise<LuisBenefitsTestFlowResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const headers = { Authorization: `Bearer ${input.accessToken}` };
  let flowId: string | null = null;

  try {
    const createBody = new FormData();
    createBody.set("name", LUIS_BENEFITS_TEST_FLOW_NAME);
    createBody.set("categories", JSON.stringify(["OTHER"]));
    const createResponse = await fetchFn(
      graphUrl(`${META_TEST_WABA_ID}/flows`),
      { method: "POST", headers, body: createBody },
    );
    const createResult = await readMetaJson(createResponse);
    flowId = text(createResult.payload?.id, 100) || null;
    if (!createResponse.ok || createResult.diagnostic || !flowId) {
      return luisBenefitsTestFlowFailure(
        input,
        !createResponse.ok
          ? safeMetaReadDiagnostic(createResponse.status, createResult.payload)
          : createResult.diagnostic ?? invalidMetaResponseDiagnostic(createResponse.status),
      );
    }
    return await uploadAndReadLuisBenefitsTestFlow(input, flowId);
  } catch {
    return luisBenefitsTestFlowFailure(
      input,
      networkMetaReadDiagnostic(),
      flowId,
    );
  }
}

export async function validateStoredWhatsAppAssets(
  input: MetaAssetValidationInput,
) {
  const fetchFn = input.fetchFn ?? fetch;
  const safeGet = (path: string) => fetchFn(
    `https://graph.facebook.com/${input.graphVersion}/${path}`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  const expectedPhone = normalizedPhone(input.expectedDisplayNumber);
  let phoneIdAccessible = false;
  let displayNumberMatch: ValidationStatus = "UNKNOWN";
  let wabaMatch: ValidationStatus = "UNKNOWN";
  let messagingAssetAccessible = false;
  let webhookStatus: ValidationStatus = "UNKNOWN";
  let phoneIdDiagnostic: SafeMetaReadDiagnostic | undefined;
  let wabaDiagnostic: SafeMetaReadDiagnostic | undefined;
  let subscriptionDiagnostic: SafeMetaReadDiagnostic | undefined;

  try {
    const phoneResponse = await safeGet(
      `${encodeURIComponent(input.phoneNumberId)}?fields=id,display_phone_number,status,code_verification_status`,
    );
    const result = await readMetaJson(phoneResponse);
    if (!phoneResponse.ok) phoneIdDiagnostic = safeMetaReadDiagnostic(phoneResponse.status, result.payload);
    if (result.diagnostic && phoneResponse.ok) phoneIdDiagnostic = result.diagnostic;
    const phone = result.payload;
    phoneIdAccessible = phoneResponse.ok && !result.diagnostic && text(phone?.id, 100) === input.phoneNumberId;
    displayNumberMatch = !phoneResponse.ok || result.diagnostic
      ? "UNKNOWN"
      : phoneIdAccessible
      ? normalizedPhone(phone?.display_phone_number) === expectedPhone ? "PASS" : "FAIL"
      : "FAIL";
  } catch {
    phoneIdAccessible = false;
    displayNumberMatch = "UNKNOWN";
    phoneIdDiagnostic = networkMetaReadDiagnostic();
  }

  try {
    const wabaResponse = await safeGet(
      `${encodeURIComponent(input.wabaId)}/phone_numbers?fields=id,display_phone_number`,
    );
    const result = await readMetaJson(wabaResponse);
    if (!wabaResponse.ok) wabaDiagnostic = safeMetaReadDiagnostic(wabaResponse.status, result.payload);
    if (result.diagnostic && wabaResponse.ok) wabaDiagnostic = result.diagnostic;
    const waba = result.payload;
    const phone = Array.isArray(waba?.data)
      ? waba.data.find((item: unknown) =>
        text((item as Record<string, unknown>)?.id, 100) === input.phoneNumberId
      ) as Record<string, unknown> | undefined
      : undefined;
    wabaMatch = wabaResponse.ok && !result.diagnostic ? phone ? "PASS" : "FAIL" : "UNKNOWN";
    if (phone && normalizedPhone(phone.display_phone_number) !== expectedPhone) {
      displayNumberMatch = "FAIL";
    }
    messagingAssetAccessible = phoneIdAccessible && wabaMatch === "PASS";
  } catch {
    wabaMatch = "UNKNOWN";
    wabaDiagnostic = networkMetaReadDiagnostic();
  }

  try {
    const subscriptionResponse = await safeGet(
      `${encodeURIComponent(input.wabaId)}/subscribed_apps`,
    );
    const result = await readMetaJson(subscriptionResponse);
    if (!subscriptionResponse.ok) subscriptionDiagnostic = safeMetaReadDiagnostic(subscriptionResponse.status, result.payload);
    if (result.diagnostic && subscriptionResponse.ok) subscriptionDiagnostic = result.diagnostic;
    const subscription = result.payload;
    if (subscriptionResponse.ok && !result.diagnostic && Array.isArray(subscription?.data)) {
      webhookStatus = subscription.data.some((item: unknown) =>
        whatsAppApplicationId(item) === input.expectedAppId
      ) ? "PASS" : "FAIL";
    }
  } catch {
    webhookStatus = "UNKNOWN";
    subscriptionDiagnostic = networkMetaReadDiagnostic();
  }

  const requiredPass = phoneIdAccessible && displayNumberMatch === "PASS" &&
    wabaMatch === "PASS" && messagingAssetAccessible;
  const diagnostics = {
    ...(phoneIdDiagnostic ? { phone_id: phoneIdDiagnostic } : {}),
    ...(wabaDiagnostic ? { waba: wabaDiagnostic } : {}),
    ...(subscriptionDiagnostic ? { subscription: subscriptionDiagnostic } : {}),
  };
  return {
    token_configured: true,
    phone_id_accessible: phoneIdAccessible,
    display_number_match: displayNumberMatch,
    waba_match: wabaMatch,
    messaging_asset_accessible: messagingAssetAccessible,
    webhook_status: webhookStatus,
    app_relationship: webhookStatus,
    recipient_authorization: "UNKNOWN" as ValidationStatus,
    credential_status: credentialStatusFromDiagnostics([
      phoneIdDiagnostic,
      wabaDiagnostic,
      subscriptionDiagnostic,
    ]),
    ...(Object.keys(diagnostics).length ? { meta_diagnostics: diagnostics } : {}),
    overall: requiredPass ? "PARTIAL" : "FAIL",
  };
}

function discoveryFailureFromDiagnostic(
  diagnostic: SafeMetaReadDiagnostic | undefined,
): LuisWhatsAppAssetDiscoveryFailure {
  const error = diagnostic?.meta_error;
  const message = error?.message?.toLowerCase() ?? "";
  if (/insufficient scope/.test(message)) return "INSUFFICIENT_TOKEN_SCOPE";
  if (
    error?.code === 10 || error?.code === 200 ||
    /permission|not authorized|access denied/.test(message)
  ) return "META_PERMISSION_BLOCKED";
  return "UNKNOWN";
}

function discoveryFailure(
  failure: LuisWhatsAppAssetDiscoveryFailure,
  diagnostic?: SafeMetaReadDiagnostic,
): LuisWhatsAppAssetDiscovery {
  return {
    found: false,
    organization_id: REFERRAL_HUB_ORGANIZATION_ID,
    creatyv_waba_access: "UNKNOWN",
    creatyv_phone_access: "UNKNOWN",
    app_relationship: "UNKNOWN",
    credential_status: credentialStatusFromDiagnostics([diagnostic]),
    recovery_capability: failure === "UNKNOWN"
      ? "UNKNOWN"
      : "ASSETS_NOT_RECOVERABLE",
    failure,
    ...(diagnostic ? { meta_diagnostic: diagnostic } : {}),
  };
}

function metaRows(payload: Record<string, unknown> | undefined) {
  return Array.isArray(payload?.data)
    ? payload.data.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object"
    )
    : null;
}

// GET /<WABA_ID>/subscribed_apps returns WhatsAppApplication objects. The app's
// id/name live under whatsapp_business_api_data, not at the top level, and that
// edge does not accept a ?fields=id,name projection (Meta silently drops it and
// returns an empty id/name pair). Always read the nested object instead.
function whatsAppApplicationField(item: unknown, field: "id" | "name", maxLength: number) {
  const record = item && typeof item === "object"
    ? item as Record<string, unknown>
    : undefined;
  const nested = record?.whatsapp_business_api_data;
  const nestedRecord = nested && typeof nested === "object"
    ? nested as Record<string, unknown>
    : undefined;
  return text(nestedRecord?.[field], maxLength);
}
function whatsAppApplicationId(item: unknown) {
  return whatsAppApplicationField(item, "id", 100);
}
function whatsAppApplicationName(item: unknown) {
  return whatsAppApplicationField(item, "name", 160);
}

function safeMetaEpoch(value: unknown) {
  const parsed = safeMetaInteger(value);
  return parsed !== undefined ? parsed : null;
}

function safeMetaScopes(value: unknown) {
  return Array.isArray(value)
    ? value.map((scope) => text(scope, 100)).filter(Boolean).slice(0, 100)
    : [];
}

function safeMetaGranularScopes(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((scope) => {
      const item = scope && typeof scope === "object"
        ? scope as Record<string, unknown>
        : undefined;
      const permission = text(item?.permission, 100);
      if (!permission) return [];
      const targetIds = Array.isArray(item?.target_ids)
        ? item.target_ids.map((id) => text(id, 100)).filter(Boolean).slice(0, 100)
        : [];
      return [{ permission, target_ids: targetIds }];
    }).slice(0, 100)
    : [];
}

function granularTargetAccess(
  granularScopes: Array<{ permission: string; target_ids: string[] }>,
  targetId: string,
): ValidationStatus {
  const targetIds = granularScopes.flatMap((scope) => scope.target_ids);
  if (targetIds.length === 0) return "UNKNOWN";
  return targetIds.includes(targetId) ? "PASS" : "FAIL";
}

export async function debugLuisStoredWhatsAppToken(
  input: LuisStoredTokenDebugInput,
): Promise<LuisStoredTokenDebug> {
  const fetchFn = input.fetchFn ?? fetch;
  try {
    const response = await fetchFn(
      `https://graph.facebook.com/${input.graphVersion}/debug_token?input_token=${encodeURIComponent(input.accessToken)}`,
      { headers: { Authorization: `Bearer ${input.appId}|${input.appSecret}` } },
    );
    const result = await readMetaJson(response);
    if (!response.ok || result.diagnostic || !result.payload?.data ||
      typeof result.payload.data !== "object"
    ) {
      const diagnostic = !response.ok
        ? safeMetaReadDiagnostic(response.status, result.payload)
        : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status);
      return {
        token_configured: true,
        is_valid: null,
        app_id: null,
        application: null,
        token_type: null,
        issued_at: null,
        expires_at: null,
        scopes: [],
        granular_scopes: [],
        token_matches_expected_app: null,
        has_whatsapp_business_management: false,
        has_whatsapp_business_messaging: false,
        waba_1423647499608507_granular_access: "UNKNOWN",
        phone_1287679991091560_granular_access: "UNKNOWN",
        credential_status: credentialStatusFromDiagnostics([diagnostic]),
        meta_diagnostic: diagnostic,
      };
    }
    const data = result.payload.data as Record<string, unknown>;
    const appId = text(data.app_id, 100) || null;
    const scopes = safeMetaScopes(data.scopes);
    const granularScopes = safeMetaGranularScopes(data.granular_scopes);
    const permissions = new Set([
      ...scopes,
      ...granularScopes.map((scope) => scope.permission),
    ]);
    return {
      token_configured: true,
      is_valid: typeof data.is_valid === "boolean" ? data.is_valid : null,
      app_id: appId,
      application: text(data.application, 160) || null,
      token_type: text(data.type, 100) || null,
      issued_at: safeMetaEpoch(data.issued_at),
      expires_at: safeMetaEpoch(data.expires_at),
      scopes,
      granular_scopes: granularScopes,
      token_matches_expected_app: appId ? appId === input.appId : null,
      has_whatsapp_business_management: permissions.has(
        "whatsapp_business_management",
      ),
      has_whatsapp_business_messaging: permissions.has(
        "whatsapp_business_messaging",
      ),
      waba_1423647499608507_granular_access: granularTargetAccess(
        granularScopes,
        input.expectedWabaId,
      ),
      phone_1287679991091560_granular_access: granularTargetAccess(
        granularScopes,
        input.expectedPhoneNumberId,
      ),
      credential_status: "UNKNOWN",
    };
  } catch {
    const diagnostic = networkMetaReadDiagnostic();
    return {
      token_configured: true,
      is_valid: null,
      app_id: null,
      application: null,
      token_type: null,
      issued_at: null,
      expires_at: null,
      scopes: [],
      granular_scopes: [],
      token_matches_expected_app: null,
      has_whatsapp_business_management: false,
      has_whatsapp_business_messaging: false,
      waba_1423647499608507_granular_access: "UNKNOWN",
      phone_1287679991091560_granular_access: "UNKNOWN",
      credential_status: "UNKNOWN",
      meta_diagnostic: diagnostic,
    };
  }
}

function directLuisDiscoveryUnavailable(
  expectedAppId: string,
  wabaId?: string,
  phoneNumberId?: string,
): LuisWhatsAppDirectAssetDiscovery {
  return {
    found: false,
    organization_id: REFERRAL_HUB_ORGANIZATION_ID,
    persisted_waba_id: wabaId || null,
    persisted_phone_number_id: phoneNumberId || null,
    expected_app_id: expectedAppId,
    subscribed_apps: [],
    display_phone_number: null,
    verified_name: null,
    registration_status: null,
    code_verification_status: null,
    platform_type: null,
    phone_found_in_waba: "UNKNOWN",
    creatyv_phone_access: "UNKNOWN",
    creatyv_waba_access: "UNKNOWN",
    app_relationship: "UNKNOWN",
    credential_status: "UNKNOWN",
  };
}

// This intentionally uses only the canonical persisted WABA and phone IDs. It must
// remain separate from the legacy business-enumeration recovery diagnostic.
export async function discoverLuisWhatsAppAssetsDirect(
  input: LuisWhatsAppDirectAssetDiscoveryInput,
): Promise<LuisWhatsAppDirectAssetDiscovery> {
  const fetchFn = input.fetchFn ?? fetch;
  const safeGet = (path: string) => fetchFn(
    `https://graph.facebook.com/${input.graphVersion}/${path}`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  const readObject = async (path: string) => {
    try {
      const response = await safeGet(path);
      const result = await readMetaJson(response);
      if (!response.ok || result.diagnostic) {
        return {
          object: undefined,
          diagnostic: !response.ok
            ? safeMetaReadDiagnostic(response.status, result.payload)
            : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status),
        };
      }
      return { object: result.payload, diagnostic: undefined };
    } catch {
      return { object: undefined, diagnostic: networkMetaReadDiagnostic() };
    }
  };
  const readRows = async (path: string) => {
    const result = await readObject(path);
    const rows = metaRows(result.object);
    return rows
      ? { rows, diagnostic: result.diagnostic }
      : {
        rows: null,
        diagnostic: result.diagnostic ?? invalidMetaResponseDiagnostic(),
      };
  };

  const phone = await readObject(
    `${encodeURIComponent(input.phoneNumberId)}?fields=id,display_phone_number,verified_name,status,code_verification_status,platform_type`,
  );
  const phoneAccessible = Boolean(
    phone.object && text(phone.object.id, 100) === input.phoneNumberId,
  );

  const wabaPhones = await readRows(
    `${encodeURIComponent(input.wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status,platform_type&limit=25`,
  );
  const matchingWabaPhone = wabaPhones.rows?.find((row) =>
    text(row.id, 100) === input.phoneNumberId
  );
  const wabaAccessible: ValidationStatus = wabaPhones.rows
    ? "PASS"
    : wabaPhones.diagnostic?.classification === "NETWORK_ERROR" ||
        wabaPhones.diagnostic?.classification === "INVALID_META_RESPONSE"
    ? "UNKNOWN"
    : "FAIL";
  const phoneFoundInWaba: ValidationStatus = wabaPhones.rows
    ? matchingWabaPhone ? "PASS" : "FAIL"
    : "UNKNOWN";

  const subscriptions = await readRows(
    `${encodeURIComponent(input.wabaId)}/subscribed_apps?limit=25`,
  );
  const subscribedApps = subscriptions.rows?.flatMap((app) => {
    const id = whatsAppApplicationId(app);
    const name = whatsAppApplicationName(app);
    return id ? [{ id, ...(name ? { name } : {}) }] : [];
  }) ?? [];
  const appRelationship: ValidationStatus = subscriptions.rows
    ? subscriptions.rows.some((app) => whatsAppApplicationId(app) === input.expectedAppId)
      ? "PASS"
      : "FAIL"
    : "UNKNOWN";
  const phoneData = phoneAccessible ? phone.object : matchingWabaPhone;
  const diagnostics = [phone.diagnostic, wabaPhones.diagnostic, subscriptions.diagnostic];

  return {
    found: phoneAccessible && wabaAccessible === "PASS" &&
      phoneFoundInWaba === "PASS",
    organization_id: REFERRAL_HUB_ORGANIZATION_ID,
    persisted_waba_id: input.wabaId,
    persisted_phone_number_id: input.phoneNumberId,
    expected_app_id: input.expectedAppId,
    subscribed_apps: subscribedApps,
    display_phone_number: text(phoneData?.display_phone_number, 100) || null,
    verified_name: text(phoneData?.verified_name, 160) || null,
    registration_status: text(phoneData?.status, 100) || null,
    code_verification_status: text(phoneData?.code_verification_status, 100) || null,
    platform_type: text(phoneData?.platform_type, 100) || null,
    phone_found_in_waba: phoneFoundInWaba,
    creatyv_phone_access: phoneAccessible ? "PASS" : phone.diagnostic
      ? phone.diagnostic.classification === "NETWORK_ERROR" ||
          phone.diagnostic.classification === "INVALID_META_RESPONSE"
        ? "UNKNOWN"
        : "FAIL"
      : "FAIL",
    creatyv_waba_access: wabaAccessible,
    app_relationship: appRelationship,
    credential_status: credentialStatusFromDiagnostics(diagnostics),
    ...(diagnostics.find(Boolean)
      ? { meta_diagnostic: diagnostics.find(Boolean) }
      : {}),
  };
}

export async function discoverLuisWhatsAppAssets(
  input: LuisWhatsAppAssetDiscoveryInput,
): Promise<LuisWhatsAppAssetDiscovery> {
  const fetchFn = input.fetchFn ?? fetch;
  const safeGet = (path: string) => fetchFn(
    `https://graph.facebook.com/${input.graphVersion}/${path}`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  const readRows = async (path: string) => {
    try {
      const response = await safeGet(path);
      const result = await readMetaJson(response);
      if (!response.ok || result.diagnostic) {
        return {
          rows: null,
          diagnostic: !response.ok
            ? safeMetaReadDiagnostic(response.status, result.payload)
            : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status),
        };
      }
      const rows = metaRows(result.payload);
      return rows
        ? { rows, diagnostic: undefined }
        : {
          rows: null,
          diagnostic: invalidMetaResponseDiagnostic(response.status),
        };
    } catch {
      return { rows: null, diagnostic: networkMetaReadDiagnostic() };
    }
  };
  const readObject = async (path: string) => {
    try {
      const response = await safeGet(path);
      const result = await readMetaJson(response);
      if (!response.ok || result.diagnostic) {
        return {
          object: undefined,
          diagnostic: !response.ok
            ? safeMetaReadDiagnostic(response.status, result.payload)
            : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status),
        };
      }
      return { object: result.payload, diagnostic: undefined };
    } catch {
      return { object: undefined, diagnostic: networkMetaReadDiagnostic() };
    }
  };

  const businesses = await readRows("me/businesses?fields=id,name&limit=10");
  if (!businesses.rows) {
    return discoveryFailure(
      discoveryFailureFromDiagnostic(businesses.diagnostic),
      businesses.diagnostic,
    );
  }
  if (businesses.rows.length === 0) {
    return discoveryFailure("NO_SHARED_WABA_VISIBLE");
  }

  const wabas = new Map<string, { id: string; name: string | null }>();
  let discoveryDiagnostic: SafeMetaReadDiagnostic | undefined;
  for (const business of businesses.rows) {
    const businessId = text(business.id, 100);
    if (!businessId) continue;
    for (const edge of [
      "owned_whatsapp_business_accounts",
      "client_whatsapp_business_accounts",
    ]) {
      const result = await readRows(
        `${encodeURIComponent(businessId)}/${edge}?fields=id,name&limit=10`,
      );
      if (!result.rows) {
        discoveryDiagnostic ??= result.diagnostic;
        continue;
      }
      for (const candidate of result.rows) {
        const id = text(candidate.id, 100);
        if (id) wabas.set(id, { id, name: text(candidate.name, 160) || null });
      }
    }
  }
  if (wabas.size === 0) {
    return discoveryDiagnostic
      ? discoveryFailure(
        discoveryFailureFromDiagnostic(discoveryDiagnostic),
        discoveryDiagnostic,
      )
      : discoveryFailure("NO_SHARED_WABA_VISIBLE");
  }

  const expectedPhone = normalizedPhone(input.expectedDisplayNumber);
  for (const waba of wabas.values()) {
    const phones = await readRows(
      `${encodeURIComponent(waba.id)}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status,platform_type&limit=25`,
    );
    if (!phones.rows) {
      discoveryDiagnostic ??= phones.diagnostic;
      continue;
    }
    const matchingPhone = phones.rows.find((phone) =>
      normalizedPhone(phone.display_phone_number) === expectedPhone
    );
    if (!matchingPhone) continue;

    const phoneNumberId = text(matchingPhone.id, 100);
    if (!phoneNumberId) continue;
    const phone = await readObject(
      `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,status,code_verification_status,platform_type`,
    );
    const phoneData = phone.object ?? matchingPhone;
    const phoneAccessible = Boolean(
      phone.object && text(phoneData.id, 100) === phoneNumberId,
    );
    const subscriptions = await readRows(
      `${encodeURIComponent(waba.id)}/subscribed_apps?limit=25`,
    );
    const appRelationship = subscriptions.rows
      ? subscriptions.rows.some((app) =>
        whatsAppApplicationId(app) === input.expectedAppId
      ) ? "PASS" : "FAIL"
      : "UNKNOWN";
    const complete = phoneAccessible && appRelationship === "PASS";
    return {
      found: true,
      organization_id: REFERRAL_HUB_ORGANIZATION_ID,
      waba_id: waba.id,
      waba_name: waba.name,
      phone_number_id: phoneNumberId,
      display_phone_number: text(phoneData.display_phone_number, 100) ||
        text(matchingPhone.display_phone_number, 100),
      verified_name: text(phoneData.verified_name, 160) || null,
      registration_status: text(phoneData.status, 100) ||
        text(phoneData.code_verification_status, 100) || null,
      platform_type: text(phoneData.platform_type, 100) || null,
      creatyv_waba_access: true,
      creatyv_phone_access: phoneAccessible,
      app_relationship: appRelationship,
      credential_status: credentialStatusFromDiagnostics([
        phone.diagnostic,
        subscriptions.diagnostic,
      ]),
      recovery_capability: complete
        ? "ASSETS_AND_CREDENTIAL_SUFFICIENT"
        : "ASSETS_FOUND_FRESH_AUTH_REQUIRED",
      ...(phone.diagnostic || subscriptions.diagnostic
        ? { meta_diagnostic: phone.diagnostic ?? subscriptions.diagnostic }
        : {}),
    };
  }

  return discoveryDiagnostic
    ? discoveryFailure(
      discoveryFailureFromDiagnostic(discoveryDiagnostic),
      discoveryDiagnostic,
    )
    : discoveryFailure("PHONE_NOT_FOUND");
}

export async function inspectWhatsAppActivation(
  input: WhatsAppActivationInspectionInput,
): Promise<WhatsAppActivationInspection> {
  const fetchFn = input.fetchFn ?? fetch;
  const safeGet = (path: string) => fetchFn(
    `https://graph.facebook.com/${input.graphVersion}/${path}`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  let phoneDiagnostic: SafeMetaReadDiagnostic | undefined;
  let wabaDiagnostic: SafeMetaReadDiagnostic | undefined;
  let phone: Record<string, unknown> | undefined;
  try {
    const response = await safeGet(
      `${encodeURIComponent(input.phoneNumberId)}?fields=id,display_phone_number,status`,
    );
    const result = await readMetaJson(response);
    if (!response.ok) phoneDiagnostic = safeMetaReadDiagnostic(response.status, result.payload);
    if (result.diagnostic && response.ok) phoneDiagnostic = result.diagnostic;
    if (response.ok && !result.diagnostic) phone = result.payload;
  } catch {
    phoneDiagnostic = networkMetaReadDiagnostic();
  }
  const phoneAccess = Boolean(
    phone && text(phone.id, 100) === input.phoneNumberId,
  );
  let wabaRelationship: ValidationStatus = "UNKNOWN";
  try {
    const response = await safeGet(
      `${encodeURIComponent(input.wabaId)}/phone_numbers?fields=id&limit=25`,
    );
    const result = await readMetaJson(response);
    if (!response.ok) wabaDiagnostic = safeMetaReadDiagnostic(response.status, result.payload);
    if (result.diagnostic && response.ok) wabaDiagnostic = result.diagnostic;
    const rows = metaRows(result.payload);
    if (response.ok && !result.diagnostic && rows) {
      wabaRelationship = rows.some((row) =>
        text(row.id, 100) === input.phoneNumberId
      ) ? "PASS" : "FAIL";
    }
  } catch {
    wabaDiagnostic = networkMetaReadDiagnostic();
  }
  return {
    phone_number_id: input.phoneNumberId,
    display_phone_number: text(phone?.display_phone_number, 100) || null,
    meta_status: text(phone?.status, 100).toUpperCase() || null,
    phone_access: phoneAccess,
    waba_relationship: wabaRelationship,
    credential_status: credentialStatusFromDiagnostics([
      phoneDiagnostic,
      wabaDiagnostic,
    ]),
    ...(phoneDiagnostic || wabaDiagnostic
      ? { meta_diagnostic: phoneDiagnostic ?? wabaDiagnostic }
      : {}),
  };
}

// This is deliberately bound to Luis's canonical persisted assets. The runtime
// PIN is used only as the POST body and is never included in a return value,
// diagnostic, telemetry, or persistence operation.
export async function registerLuisWhatsAppBusinessPhone(
  input: LuisBusinessAppRegistrationInput,
): Promise<LuisBusinessAppRegistrationResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const authorization = { Authorization: `Bearer ${input.accessToken}` };
  const base = {
    organization_id: REFERRAL_HUB_ORGANIZATION_ID,
    waba_id: LUIS_WABA_ID,
    phone_number_id: LUIS_PHONE_NUMBER_ID,
  } as const;
  const empty = (overrides: Partial<LuisBusinessAppRegistrationResult> = {}) => ({
    ...base,
    phone_access: "UNKNOWN" as ValidationStatus,
    waba_access: "UNKNOWN" as ValidationStatus,
    phone_found_in_waba: "UNKNOWN" as ValidationStatus,
    code_verification_status: null,
    meta_status_before: null,
    meta_status_after: null,
    platform_type: null,
    display_phone_number: null,
    verified_name: null,
    already_connected: false,
    registration_attempted: false,
    registration_accepted: false,
    registration_http_status: null,
    activation_complete: false,
    ...overrides,
  });
  if (
    input.wabaId !== LUIS_WABA_ID ||
    input.phoneNumberId !== LUIS_PHONE_NUMBER_ID ||
    !/^[0-9]{6}$/.test(input.pin)
  ) return empty({ error: "registration_preflight_failed" });

  const readPhone = async () => {
    try {
      const response = await fetchFn(
        graphUrl(
          `${encodeURIComponent(LUIS_PHONE_NUMBER_ID)}?fields=id,display_phone_number,verified_name,status,code_verification_status,platform_type`,
        ),
        { headers: authorization },
      );
      const result = await readMetaJson(response);
      const diagnostic = !response.ok
        ? safeMetaReadDiagnostic(response.status, result.payload)
        : result.diagnostic;
      return {
        phone: response.ok && !diagnostic ? result.payload : undefined,
        diagnostic,
      };
    } catch {
      return { phone: undefined, diagnostic: networkMetaReadDiagnostic() };
    }
  };
  const readWabaPhones = async () => {
    try {
      const response = await fetchFn(
        graphUrl(
          `${encodeURIComponent(LUIS_WABA_ID)}/phone_numbers?fields=id&limit=25`,
        ),
        { headers: authorization },
      );
      const result = await readMetaJson(response);
      const diagnostic = !response.ok
        ? safeMetaReadDiagnostic(response.status, result.payload)
        : result.diagnostic;
      return {
        rows: response.ok && !diagnostic ? metaRows(result.payload) : null,
        diagnostic,
      };
    } catch {
      return { rows: null, diagnostic: networkMetaReadDiagnostic() };
    }
  };
  const describe = (
    phone: Record<string, unknown> | undefined,
    wabaRows: Record<string, unknown>[] | null,
    diagnostic?: SafeMetaReadDiagnostic,
  ) => {
    const phoneAccess = phone && text(phone.id, 100) === LUIS_PHONE_NUMBER_ID
      ? "PASS" as ValidationStatus
      : diagnostic ? "FAIL" as ValidationStatus : "UNKNOWN" as ValidationStatus;
    const wabaAccess = wabaRows ? "PASS" as ValidationStatus
      : diagnostic ? "FAIL" as ValidationStatus : "UNKNOWN" as ValidationStatus;
    const phoneInWaba = wabaRows
      ? wabaRows.some((row) => text(row.id, 100) === LUIS_PHONE_NUMBER_ID)
        ? "PASS" as ValidationStatus
        : "FAIL" as ValidationStatus
      : "UNKNOWN" as ValidationStatus;
    return {
      phone_access: phoneAccess,
      waba_access: wabaAccess,
      phone_found_in_waba: phoneInWaba,
      code_verification_status: text(phone?.code_verification_status, 100)
        .toUpperCase() || null,
      meta_status: text(phone?.status, 100).toUpperCase() || null,
      platform_type: text(phone?.platform_type, 100) || null,
      display_phone_number: text(phone?.display_phone_number, 100) || null,
      verified_name: text(phone?.verified_name, 160) || null,
    };
  };

  const beforePhone = await readPhone();
  const beforeWaba = await readWabaPhones();
  const beforeDiagnostic = beforePhone.diagnostic ?? beforeWaba.diagnostic;
  const before = describe(beforePhone.phone, beforeWaba.rows, beforeDiagnostic);
  const preconditionsPass = before.phone_access === "PASS" &&
    before.waba_access === "PASS" && before.phone_found_in_waba === "PASS" &&
    before.code_verification_status === "VERIFIED";
  if (!preconditionsPass) {
    return empty({
      ...before,
      meta_status_before: before.meta_status,
      error: "registration_preflight_failed",
      ...(beforeDiagnostic ? { meta_diagnostic: beforeDiagnostic } : {}),
    });
  }
  if (before.meta_status === "CONNECTED") {
    return empty({
      ...before,
      meta_status_before: before.meta_status,
      meta_status_after: before.meta_status,
      already_connected: true,
      activation_complete: true,
    });
  }
  if (before.meta_status !== "PENDING") {
    return empty({
      ...before,
      meta_status_before: before.meta_status,
      error: "registration_waiting_for_meta",
    });
  }

  let registrationStatus: number | null = null;
  try {
    const response = await fetchFn(
      graphUrl(`${encodeURIComponent(LUIS_PHONE_NUMBER_ID)}/register`),
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin: input.pin }),
      },
    );
    registrationStatus = response.status;
    const result = await readMetaJson(response);
    if (!response.ok || result.diagnostic || result.payload?.success !== true) {
      return empty({
        ...before,
        meta_status_before: before.meta_status,
        registration_attempted: true,
        registration_http_status: registrationStatus,
        error: "registration_rejected",
        meta_diagnostic: !response.ok
          ? safeMetaReadDiagnostic(response.status, result.payload)
          : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status),
      });
    }
  } catch {
    return empty({
      ...before,
      meta_status_before: before.meta_status,
      registration_attempted: true,
      registration_http_status: registrationStatus,
      error: "registration_rejected",
      meta_diagnostic: networkMetaReadDiagnostic(),
    });
  }

  const afterPhone = await readPhone();
  const afterWaba = await readWabaPhones();
  const afterDiagnostic = afterPhone.diagnostic ?? afterWaba.diagnostic;
  const after = describe(afterPhone.phone, afterWaba.rows, afterDiagnostic);
  const postconditionsPass = after.phone_access === "PASS" &&
    after.waba_access === "PASS" && after.phone_found_in_waba === "PASS";
  return empty({
    ...after,
    meta_status_before: before.meta_status,
    meta_status_after: after.meta_status,
    registration_attempted: true,
    registration_accepted: true,
    registration_http_status: registrationStatus,
    activation_complete: postconditionsPass && after.meta_status === "CONNECTED",
    ...(!postconditionsPass
      ? {
        error: "registration_verification_failed" as const,
        ...(afterDiagnostic ? { meta_diagnostic: afterDiagnostic } : {}),
      }
      : afterDiagnostic ? { meta_diagnostic: afterDiagnostic } : {}),
  });
}

function matchingWebhookUrl(actual: unknown, expected: string) {
  return text(actual, 500).replace(/\/$/, "") === expected.replace(/\/$/, "");
}

function hasMessagesSubscription(value: unknown) {
  return Array.isArray(value) && value.some((item) =>
    typeof item === "string"
      ? item === "messages"
      : text((item as Record<string, unknown>)?.name, 100) === "messages"
  );
}

async function readWabaSubscribedApps(
  input: MetaTestWabaSubscriptionInput,
): Promise<WabaSubscriptionRead> {
  const fetchFn = input.fetchFn ?? fetch;
  try {
    const response = await fetchFn(
      `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.wabaId)}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );
    const result = await readMetaJson(response);
    if (!response.ok || result.diagnostic || !Array.isArray(result.payload?.data)) {
      return {
        subscription: "UNKNOWN",
        diagnostic: !response.ok
          ? safeMetaReadDiagnostic(response.status, result.payload)
          : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status),
      };
    }
    return {
      subscription: result.payload.data.some((item: unknown) =>
        whatsAppApplicationId(item) === input.expectedAppId
      ) ? "SUBSCRIBED" : "NOT_SUBSCRIBED",
    };
  } catch {
    return { subscription: "UNKNOWN", diagnostic: networkMetaReadDiagnostic() };
  }
}

async function readLuisWabaSubscribedApps(
  input: LuisWabaAppSubscriptionInput,
) {
  const fetchFn = input.fetchFn ?? fetch;
  try {
    const response = await fetchFn(
      `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.wabaId)}/subscribed_apps`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${input.accessToken}` },
      },
    );
    const result = await readMetaJson(response);
    const rows = metaRows(result.payload);
    if (!response.ok || result.diagnostic || !rows) {
      return {
        meta_http_status: response.status,
        subscribed_apps: null,
        diagnostic: !response.ok
          ? safeMetaReadDiagnostic(response.status, result.payload)
          : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status),
      };
    }
    return {
      meta_http_status: response.status,
      subscribed_apps: rows.flatMap((app) => {
        const id = whatsAppApplicationId(app);
        const name = whatsAppApplicationName(app);
        return id ? [{ id, ...(name ? { name } : {}) }] : [];
      }),
      diagnostic: undefined,
    };
  } catch {
    return {
      meta_http_status: null,
      subscribed_apps: null,
      diagnostic: networkMetaReadDiagnostic(),
    };
  }
}

export async function readLuisCanonicalWabaSubscribedApps(
  input: Pick<LuisWabaAppSubscriptionInput, "graphVersion" | "accessToken" | "fetchFn">,
) {
  const result = await readLuisWabaSubscribedApps({
    ...input,
    wabaId: LUIS_WABA_ID,
    expectedAppId: LUIS_META_APP_ID,
  });
  const subscribedApps = (result.subscribed_apps ?? []).map((app) => ({
    app_id: app.id,
    ...(app.name ? { name: app.name } : {}),
  }));
  const expectedAppPresent = result.subscribed_apps === null
    ? "UNKNOWN"
    : result.subscribed_apps.some((app) => app.id === LUIS_META_APP_ID)
    ? "PASS"
    : "FAIL";
  return {
    ok: result.subscribed_apps !== null,
    organization_id: REFERRAL_HUB_ORGANIZATION_ID,
    waba_id: LUIS_WABA_ID,
    expected_app_id: LUIS_META_APP_ID,
    meta_http_status: result.meta_http_status,
    subscribed_apps: subscribedApps,
    expected_app_present: expectedAppPresent,
  };
}

export function safeLuisWhatsAppPersistedState(
  row: Record<string, unknown> | null,
  ok = Boolean(row),
) {
  const nullableBoolean = (value: unknown) =>
    typeof value === "boolean" ? value : null;
  return {
    ok,
    organization_id: REFERRAL_HUB_ORGANIZATION_ID,
    whatsapp_waba_id: text(row?.whatsapp_waba_id, 100) || null,
    whatsapp_phone_number_id: text(row?.whatsapp_phone_number_id, 100) || null,
    whatsapp_enabled: nullableBoolean(row?.whatsapp_enabled),
    whatsapp_registered: nullableBoolean(row?.whatsapp_registered),
    whatsapp_webhooks_subscribed: nullableBoolean(
      row?.whatsapp_webhooks_subscribed,
    ),
    whatsapp_onboarding_mode: text(row?.whatsapp_onboarding_mode, 40) || null,
    whatsapp_onboarding_event: text(row?.whatsapp_onboarding_event, 100) || null,
    whatsapp_session_info_version:
      text(row?.whatsapp_session_info_version, 20) || null,
    whatsapp_connected_at: text(row?.whatsapp_connected_at, 100) || null,
    updated_at: text(row?.updated_at, 100) || null,
  };
}

// This is deliberately limited to Luis's canonical WABA by the caller. It only
// performs the existing subscribe-and-verify sequence and never updates Supabase.
export async function subscribeLuisWabaApp(
  input: LuisWabaAppSubscriptionInput,
): Promise<LuisWabaAppSubscription> {
  const before = await readLuisWabaSubscribedApps(input);
  if (!before.subscribed_apps) {
    return {
      operation: "FAILED",
      post_executed: false,
      meta_post_result: "NOT_EXECUTED",
      meta_post_http_status: null,
      subscribed_apps: [],
      expected_app_present: "UNKNOWN",
      credential_status: credentialStatusFromDiagnostics([before.diagnostic]),
      ...(before.diagnostic ? { meta_diagnostic: before.diagnostic } : {}),
    };
  }
  if (before.subscribed_apps.some((app) => app.id === input.expectedAppId)) {
    return {
      operation: "ALREADY_SUBSCRIBED",
      post_executed: false,
      meta_post_result: "NOT_EXECUTED",
      meta_post_http_status: null,
      subscribed_apps: before.subscribed_apps,
      expected_app_present: "PASS",
      credential_status: "UNKNOWN",
    };
  }

  const fetchFn = input.fetchFn ?? fetch;
  let postDiagnostic: SafeMetaReadDiagnostic | undefined;
  let postStatus: number | null = null;
  try {
    const response = await fetchFn(
      `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.wabaId)}/subscribed_apps`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.accessToken}` },
      },
    );
    postStatus = response.status;
    const result = await readMetaJson(response);
    if (!response.ok || result.diagnostic || result.payload?.success !== true) {
      postDiagnostic = !response.ok
        ? safeMetaReadDiagnostic(response.status, result.payload)
        : result.diagnostic ?? invalidMetaResponseDiagnostic(response.status);
      return {
        operation: "FAILED",
        post_executed: true,
        meta_post_result: "FAILED",
        meta_post_http_status: postStatus,
        subscribed_apps: before.subscribed_apps,
        expected_app_present: "FAIL",
        credential_status: credentialStatusFromDiagnostics([postDiagnostic]),
        ...(postDiagnostic ? { meta_diagnostic: postDiagnostic } : {}),
      };
    }
  } catch {
    postDiagnostic = networkMetaReadDiagnostic();
    return {
      operation: "FAILED",
      post_executed: true,
      meta_post_result: "FAILED",
      meta_post_http_status: postStatus,
      subscribed_apps: before.subscribed_apps,
      expected_app_present: "FAIL",
      credential_status: credentialStatusFromDiagnostics([postDiagnostic]),
      meta_diagnostic: postDiagnostic,
    };
  }

  const after = await readLuisWabaSubscribedApps(input);
  const appPresent = after.subscribed_apps
    ? after.subscribed_apps.some((app) => app.id === input.expectedAppId)
      ? "PASS"
      : "FAIL"
    : "UNKNOWN";
  return {
    operation: appPresent === "PASS" ? "SUBSCRIBED" : "FAILED",
    post_executed: true,
    meta_post_result: "SUCCESS",
    meta_post_http_status: postStatus,
    subscribed_apps: after.subscribed_apps ?? before.subscribed_apps,
    expected_app_present: appPresent,
    credential_status: credentialStatusFromDiagnostics([after.diagnostic]),
    ...(after.diagnostic ? { meta_diagnostic: after.diagnostic } : {}),
  };
}

export async function inspectStoredTestWabaSubscription(
  input: MetaTestWabaSubscriptionInput,
): Promise<MetaTestWabaInspection> {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const authorization = { Authorization: `Bearer ${input.accessToken}` };
  let before: WabaSubscriptionStatus = "UNKNOWN";

  try {
    const currentResponse = await fetchFn(
      graphUrl(`${encodeURIComponent(input.wabaId)}/subscribed_apps`),
      { headers: authorization },
    );
    const result = await readMetaJson(currentResponse);
    if (!currentResponse.ok || result.diagnostic || !Array.isArray(result.payload?.data)) {
      const diagnostic = !currentResponse.ok
        ? safeMetaReadDiagnostic(currentResponse.status, result.payload)
        : result.diagnostic ?? invalidMetaResponseDiagnostic(currentResponse.status);
      return {
        before,
        app_webhook_status: "UNKNOWN" as ValidationStatus,
        callback_url: "UNKNOWN" as const,
        messages_subscription: "UNKNOWN" as ValidationStatus,
        status: "FAILED" as const,
        error: "subscription_status_unavailable",
        upstream_status: currentResponse.status,
        meta_diagnostics: { subscribed_apps: diagnostic },
      };
    }
    before = result.payload.data.some((item: unknown) =>
      whatsAppApplicationId(item) === input.expectedAppId
    ) ? "SUBSCRIBED" : "NOT_SUBSCRIBED";
  } catch {
    return {
      before,
      app_webhook_status: "UNKNOWN" as ValidationStatus,
      callback_url: "UNKNOWN" as const,
      messages_subscription: "UNKNOWN" as ValidationStatus,
      status: "FAILED" as const,
      error: "subscription_status_unavailable",
      meta_diagnostics: { subscribed_apps: networkMetaReadDiagnostic() },
    };
  }

  let appWebhookStatus: ValidationStatus = "UNKNOWN";
  let callbackUrl: MetaTestWabaInspection["callback_url"] = "UNKNOWN";
  let messagesSubscription: ValidationStatus = "UNKNOWN";
  try {
    const appResponse = await fetchFn(
      graphUrl(`${encodeURIComponent(input.expectedAppId)}/subscriptions?fields=object,callback_url,fields`),
      { headers: authorization },
    );
    const result = await readMetaJson(appResponse);
    if (appResponse.ok && !result.diagnostic && Array.isArray(result.payload?.data)) {
      const whatsappSubscription = result.payload.data.find((item: unknown) =>
        text((item as Record<string, unknown>)?.object, 100) ===
          "whatsapp_business_account"
      ) as Record<string, unknown> | undefined;
      appWebhookStatus = !whatsappSubscription
        ? "FAIL"
        : text(whatsappSubscription.callback_url, 500)
        ? matchingWebhookUrl(whatsappSubscription.callback_url, input.expectedWebhookUrl)
          ? "PASS"
          : "FAIL"
        : "UNKNOWN";
      callbackUrl = !whatsappSubscription || !text(whatsappSubscription.callback_url, 500)
        ? "UNKNOWN"
        : appWebhookStatus === "PASS" ? "MATCH" : "MISMATCH";
      messagesSubscription = !whatsappSubscription
        ? "FAIL"
        : Array.isArray(whatsappSubscription.fields)
        ? hasMessagesSubscription(whatsappSubscription.fields) ? "PASS" : "FAIL"
        : "UNKNOWN";
    } else {
      const diagnostic = !appResponse.ok
        ? safeMetaReadDiagnostic(appResponse.status, result.payload)
        : result.diagnostic ?? invalidMetaResponseDiagnostic(appResponse.status);
      return {
        before,
        app_webhook_status: "UNKNOWN",
        callback_url: "UNKNOWN",
        messages_subscription: "UNKNOWN",
        status: "PARTIAL",
        error: "app_subscription_unavailable",
        upstream_status: appResponse.status,
        meta_diagnostics: { app_webhook: diagnostic },
      };
    }
  } catch {
    return {
      before,
      app_webhook_status: "UNKNOWN",
      callback_url: "UNKNOWN",
      messages_subscription: "UNKNOWN",
      status: "PARTIAL",
      error: "app_subscription_unavailable",
      meta_diagnostics: { app_webhook: networkMetaReadDiagnostic() },
    };
  }
  return {
    before,
    app_webhook_status: appWebhookStatus,
    callback_url: callbackUrl,
    messages_subscription: messagesSubscription,
    status: appWebhookStatus === "PASS" && messagesSubscription === "PASS"
      ? "PASS"
      : "PARTIAL",
  };
}

export async function subscribeStoredTestWaba(
  input: MetaTestWabaSubscriptionInput,
) {
  const fetchFn = input.fetchFn ?? fetch;
  const graphUrl = (path: string) =>
    `https://graph.facebook.com/${input.graphVersion}/${path}`;
  const authorization = { Authorization: `Bearer ${input.accessToken}` };
  const preflight = await readWabaSubscribedApps(input);
  if (preflight.subscription === "UNKNOWN") {
    return {
      before: preflight.subscription,
      operation: "FAILED" as WabaSubscriptionOperation,
      after: "UNKNOWN" as WabaSubscriptionStatus,
      app_id_present: "UNKNOWN" as const,
      app_webhook_status: "UNKNOWN" as ValidationStatus,
      messages_subscription: "UNKNOWN" as ValidationStatus,
      error: "subscription_status_unavailable",
      ...(preflight.diagnostic ? { meta_diagnostics: { subscribed_apps: preflight.diagnostic } } : {}),
    };
  }
  if (preflight.subscription === "SUBSCRIBED") {
    return {
      before: preflight.subscription,
      operation: "ALREADY_SUBSCRIBED" as WabaSubscriptionOperation,
      after: "SUBSCRIBED" as WabaSubscriptionStatus,
      app_id_present: "YES" as const,
      app_webhook_status: "UNKNOWN" as ValidationStatus,
      messages_subscription: "UNKNOWN" as ValidationStatus,
    };
  }

  try {
    const subscribeResponse = await fetchFn(
      graphUrl(`${encodeURIComponent(input.wabaId)}/subscribed_apps`),
      { method: "POST", headers: authorization },
    );
    const result = await readMetaJson(subscribeResponse);
    if (subscribeResponse.ok && !result.diagnostic && result.payload?.success === true) {
      const verification = await readWabaSubscribedApps(input);
      if (verification.subscription !== "SUBSCRIBED") {
        return {
          before: preflight.subscription,
          operation: "FAILED" as WabaSubscriptionOperation,
          after: verification.subscription,
          app_id_present: verification.subscription === "NOT_SUBSCRIBED" ? "NO" : "UNKNOWN",
          app_webhook_status: "UNKNOWN" as ValidationStatus,
          messages_subscription: "UNKNOWN" as ValidationStatus,
          error: "subscription_not_verified",
          ...(verification.diagnostic ? { meta_diagnostics: { verification: verification.diagnostic } } : {}),
        };
      }
      return {
        before: preflight.subscription,
        operation: "SUBSCRIBED" as WabaSubscriptionOperation,
        after: verification.subscription,
        app_id_present: "YES" as const,
        app_webhook_status: "UNKNOWN" as ValidationStatus,
        messages_subscription: "UNKNOWN" as ValidationStatus,
      };
    }
    return {
      before: preflight.subscription,
      operation: "FAILED" as WabaSubscriptionOperation,
      after: "UNKNOWN" as WabaSubscriptionStatus,
      app_id_present: "UNKNOWN" as const,
      app_webhook_status: "UNKNOWN" as ValidationStatus,
      messages_subscription: "UNKNOWN" as ValidationStatus,
      error: "meta_subscription_rejected",
      meta_diagnostics: {
        post: safeMetaReadDiagnostic(subscribeResponse.status, result.payload),
      },
    };
  } catch {
    return {
      before: preflight.subscription,
      operation: "FAILED" as WabaSubscriptionOperation,
      after: "UNKNOWN" as WabaSubscriptionStatus,
      app_id_present: "UNKNOWN" as const,
      app_webhook_status: "UNKNOWN" as ValidationStatus,
      messages_subscription: "UNKNOWN" as ValidationStatus,
      error: "meta_subscription_unavailable",
      meta_diagnostics: { post: networkMetaReadDiagnostic() },
    };
  }
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(req) });
    }
    if (req.method !== "POST") {
      return json(req, 405, { ok: false, error: "method_not_allowed" });
    }
    const requestOrigin = req.headers.get("origin") ?? "";
    if (!ALLOWED_ORIGINS.has(requestOrigin)) {
      return json(req, 403, { ok: false, error: "invalid_origin" });
    }
    try {
      const supabaseUrl = env("SUPABASE_URL");
      const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY");
      const metaAppId = env("META_APP_ID");
      const metaAppSecret = env("META_APP_SECRET");
      const graphVersion = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
      const bearer = (req.headers.get("authorization") ?? "").replace(
        /^Bearer\s+/i,
        "",
      ).trim();
      if (!bearer) {
        return json(req, 401, { ok: false, error: "unauthorized" });
      }

      const admin = createClient(supabaseUrl, serviceRole, {
        auth: { persistSession: false },
      });
      const userResult = await admin.auth.getUser(bearer);
      const userId = userResult.data.user?.id;
      if (!userId) {
        return json(req, 401, { ok: false, error: "unauthorized" });
      }
      const membership = await admin.from("org_members").select("role").eq(
        "organization_id",
        REFERRAL_HUB_ORGANIZATION_ID,
      ).eq("user_id", userId).maybeSingle();
      if (!membership.data) {
        return json(req, 403, {
          ok: false,
          error: "organization_membership_required",
        });
      }
      if (!mayManageWhatsApp(membership.data.role)) {
        return json(req, 403, { ok: false, error: "owner_or_admin_required" });
      }

      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const suppliedOrg = text(body.organization_id, 100);
      if (
        suppliedOrg && suppliedOrg !== REFERRAL_HUB_ORGANIZATION_ID
      ) {
        return json(req, 403, { ok: false, error: "organization_forbidden" });
      }
      const action = text(body.action, 64) || "exchange";
      if (action === "create_state") {
        try {
          return json(req, 200, {
            ok: true,
            state: await createSignupState(userId, metaAppSecret),
            return_to: "/integrations",
          });
        } catch {
          return json(req, 500, { ok: false, error: "state_signing_failed" });
        }
      }
      if (
        action === "resume_luis_benefits_test_flow" ||
        action === "create_luis_benefits_test_flow"
      ) {
        const forbiddenClientFields = [
          "waba_id",
          "phone_number_id",
          "flow_id",
          "access_token",
          "token",
          "credential",
        ];
        if (forbiddenClientFields.some((field) =>
          Object.prototype.hasOwnProperty.call(body, field)
        )) {
          return json(req, 400, {
            ok: false,
            error: "test_flow_client_identity_forbidden",
          });
        }
        const testAccessToken = text(
          Deno.env.get("META_WHATSAPP_TEST_ACCESS_TOKEN"),
          4_000,
        );
        if (!testAccessToken) {
          return json(req, 200, {
            ok: false,
            flow: {
              test_waba_id: META_TEST_WABA_ID,
              test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
              token_configured: false,
              error: "test_flow_credential_not_configured",
            },
          });
        }
        const flow = await resumeLuisBenefitsTestFlow({
          graphVersion,
          accessToken: testAccessToken,
        });
        return json(req, 200, {
          ok: flow.meta_accepted,
          flow: { token_configured: true, ...flow },
        });
      }
      if (action === "create_luis_legal_test_flows") {
        const forbiddenClientFields = [
          "waba_id",
          "phone_number_id",
          "flow_id",
          "access_token",
          "token",
          "credential",
        ];
        if (forbiddenClientFields.some((field) =>
          Object.prototype.hasOwnProperty.call(body, field)
        )) {
          return json(req, 400, {
            ok: false,
            error: "test_flow_client_identity_forbidden",
          });
        }
        const testAccessToken = text(
          Deno.env.get("META_WHATSAPP_TEST_ACCESS_TOKEN"),
          4_000,
        );
        if (!testAccessToken) {
          return json(req, 200, {
            ok: false,
            flows: {
              test_waba_id: META_TEST_WABA_ID,
              test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
              token_configured: false,
              error: "test_flow_credential_not_configured",
            },
          });
        }
        const flows = await createLuisLegalTestFlows({
          graphVersion,
          accessToken: testAccessToken,
        });
        return json(req, 200, {
          ok: flows.length === LUIS_LEGAL_TEST_FLOW_DEFINITIONS.length &&
            flows.every((flow) => flow.meta_accepted),
          flows: { token_configured: true, items: flows },
        });
      }
      if (action === "inspect_luis_test_flow_access") {
        const forbiddenClientFields = [
          "waba_id",
          "phone_number_id",
          "flow_id",
          "access_token",
          "token",
          "credential",
        ];
        if (forbiddenClientFields.some((field) =>
          Object.prototype.hasOwnProperty.call(body, field)
        )) {
          return json(req, 400, {
            ok: false,
            error: "test_flow_client_identity_forbidden",
          });
        }
        const testAccessToken = text(
          Deno.env.get("META_WHATSAPP_TEST_ACCESS_TOKEN"),
          4_000,
        );
        if (!testAccessToken) {
          return json(req, 200, {
            ok: false,
            inspection: {
              test_waba_id: META_TEST_WABA_ID,
              test_phone_number_id: META_TEST_PHONE_NUMBER_ID,
              token_configured: false,
              error: "test_flow_credential_not_configured",
            },
          });
        }
        const inspection = await inspectLuisTestFlowAccess({
          graphVersion,
          accessToken: testAccessToken,
        });
        return json(req, 200, {
          ok: inspection.flows.every((flow) => flow.accessible),
          inspection: { token_configured: true, ...inspection },
        });
      }
      if (action === "validate_test_assets") {
        const phoneNumberId = text(body.phone_number_id, 100);
        const wabaId = text(body.waba_id, 100);
        const expectedDisplayNumber = text(body.expected_display_number, 100);
        const expectedRecipient = text(body.expected_recipient, 100);
        if (!phoneNumberId || !wabaId || !expectedDisplayNumber || !expectedRecipient) {
          return json(req, 400, { ok: false, error: "validation_input_invalid" });
        }
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        if (stored.error || !accessToken) {
          return json(req, 200, {
            ok: false,
            validation: {
              token_configured: false,
              phone_id_accessible: false,
              display_number_match: "UNKNOWN",
              waba_match: "UNKNOWN",
              messaging_asset_accessible: false,
              webhook_status: "UNKNOWN",
              app_relationship: "UNKNOWN",
              recipient_authorization: "UNKNOWN",
              overall: "FAIL",
            },
          });
        }
        const validation = await validateStoredWhatsAppAssets({
          graphVersion,
          accessToken,
          phoneNumberId,
          wabaId,
          expectedDisplayNumber,
          expectedAppId: metaAppId,
          expectedRecipient,
        });
        return json(req, 200, {
          ok: validation.overall !== "FAIL",
          validation,
        });
      }
      if (action === "discover_luis_whatsapp_assets") {
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        if (stored.error || !accessToken) {
          return json(req, 200, {
            ok: false,
            discovery: {
              ...discoveryFailure("UNKNOWN"),
              token_configured: false,
            },
          });
        }
        const discovery = await discoverLuisWhatsAppAssets({
          graphVersion,
          accessToken,
          expectedDisplayNumber: LUIS_COMMERCIAL_PHONE,
          expectedAppId: metaAppId,
        });
        return json(req, 200, {
          ok: discovery.found,
          discovery: { token_configured: true, ...discovery },
        });
      }
      if (action === "read_luis_waba_subscribed_apps") {
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        if (stored.error || !accessToken || metaAppId !== LUIS_META_APP_ID) {
          return json(req, 200, {
            ok: false,
            organization_id: REFERRAL_HUB_ORGANIZATION_ID,
            waba_id: LUIS_WABA_ID,
            expected_app_id: LUIS_META_APP_ID,
            meta_http_status: null,
            subscribed_apps: [],
            expected_app_present: "UNKNOWN",
          });
        }
        const diagnostic = await readLuisCanonicalWabaSubscribedApps({
          graphVersion,
          accessToken,
        });
        return json(req, diagnostic.ok ? 200 : 502, diagnostic);
      }
      if (action === "read_luis_whatsapp_persisted_state") {
        const stored = await admin.from("org_settings").select(
          "whatsapp_waba_id,whatsapp_phone_number_id,whatsapp_enabled,whatsapp_registered,whatsapp_webhooks_subscribed,whatsapp_onboarding_mode,whatsapp_onboarding_event,whatsapp_session_info_version,whatsapp_connected_at,updated_at",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        return json(
          req,
          200,
          safeLuisWhatsAppPersistedState(
            (stored.data ?? null) as Record<string, unknown> | null,
            !stored.error && Boolean(stored.data),
          ),
        );
      }
      if (action === "discover_luis_whatsapp_assets_direct") {
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token,whatsapp_phone_number_id,whatsapp_waba_id",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        const phoneNumberId = text(stored.data?.whatsapp_phone_number_id, 100);
        const wabaId = text(stored.data?.whatsapp_waba_id, 100);
        if (stored.error || !accessToken || !phoneNumberId || !wabaId) {
          return json(req, 200, {
            ok: false,
            discovery: {
              token_configured: Boolean(accessToken),
              ...directLuisDiscoveryUnavailable(metaAppId, wabaId, phoneNumberId),
            },
          });
        }
        const discovery = await discoverLuisWhatsAppAssetsDirect({
          graphVersion,
          accessToken,
          wabaId,
          phoneNumberId,
          expectedAppId: metaAppId,
        });
        return json(req, 200, {
          ok: discovery.found,
          discovery: { token_configured: true, ...discovery },
        });
      }
      if (action === "debug_luis_whatsapp_token") {
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token,whatsapp_phone_number_id,whatsapp_waba_id",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        const phoneNumberId = text(stored.data?.whatsapp_phone_number_id, 100);
        const wabaId = text(stored.data?.whatsapp_waba_id, 100);
        const preflightPasses = !stored.error && Boolean(accessToken) &&
          wabaId === LUIS_WABA_ID && phoneNumberId === LUIS_PHONE_NUMBER_ID &&
          metaAppId === LUIS_META_APP_ID;
        const preflight = {
          organization_id: REFERRAL_HUB_ORGANIZATION_ID,
          persisted_waba_id: wabaId || null,
          persisted_phone_number_id: phoneNumberId || null,
          expected_app_id: metaAppId,
          status: preflightPasses ? "PASS" : "FAIL",
        } as const;
        if (!preflightPasses) {
          return json(req, 409, {
            ok: false,
            preflight,
            error: "luis_token_debug_identity_mismatch",
          });
        }
        const diagnostic = await debugLuisStoredWhatsAppToken({
          graphVersion,
          accessToken,
          appId: metaAppId,
          appSecret: metaAppSecret,
          expectedWabaId: LUIS_WABA_ID,
          expectedPhoneNumberId: LUIS_PHONE_NUMBER_ID,
        });
        return json(req, 200, { ok: true, preflight, diagnostic });
      }
      if (action === "subscribe_luis_waba_app") {
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token,whatsapp_phone_number_id,whatsapp_waba_id",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        const phoneNumberId = text(stored.data?.whatsapp_phone_number_id, 100);
        const wabaId = text(stored.data?.whatsapp_waba_id, 100);
        const preflightPasses = !stored.error && Boolean(accessToken) &&
          wabaId === LUIS_WABA_ID && phoneNumberId === LUIS_PHONE_NUMBER_ID &&
          metaAppId === LUIS_META_APP_ID;
        const preflight = {
          organization_id: REFERRAL_HUB_ORGANIZATION_ID,
          persisted_waba_id: wabaId || null,
          persisted_phone_number_id: phoneNumberId || null,
          expected_app_id: metaAppId,
          status: preflightPasses ? "PASS" : "FAIL",
        } as const;
        if (!preflightPasses) {
          return json(req, 409, {
            ok: false,
            preflight,
            error: "luis_subscription_identity_mismatch",
          });
        }
        const subscription = await subscribeLuisWabaApp({
          graphVersion,
          accessToken,
          wabaId,
          expectedAppId: metaAppId,
        });
        const discovery = await discoverLuisWhatsAppAssetsDirect({
          graphVersion,
          accessToken,
          wabaId,
          phoneNumberId,
          expectedAppId: metaAppId,
        });
        return json(req, subscription.expected_app_present === "PASS" &&
            discovery.app_relationship === "PASS"
          ? 200
          : 502, {
          ok: subscription.expected_app_present === "PASS" &&
            discovery.app_relationship === "PASS",
          preflight,
          subscription,
          discovery: { token_configured: true, ...discovery },
        });
      }
      if (action === "register_whatsapp_business_phone") {
        // This action is intentionally single-tenant and accepts no caller-selected
        // Meta assets or credentials. The only client input is the ephemeral PIN.
        const forbiddenClientFields = [
          "waba_id",
          "phone_number_id",
          "access_token",
          "token",
          "credential",
        ];
        if (forbiddenClientFields.some((field) =>
          Object.prototype.hasOwnProperty.call(body, field)
        )) {
          return json(req, 400, {
            ok: false,
            error: "registration_client_identity_forbidden",
          });
        }
        const runtimePin = typeof body.pin === "string" ? body.pin : "";
        if (!/^[0-9]{6}$/.test(runtimePin)) {
          return json(req, 400, { ok: false, error: "registration_pin_invalid" });
        }
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token,whatsapp_phone_number_id,whatsapp_waba_id,whatsapp_enabled",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        const phoneNumberId = text(stored.data?.whatsapp_phone_number_id, 100);
        const wabaId = text(stored.data?.whatsapp_waba_id, 100);
        if (
          stored.error || !accessToken || wabaId !== LUIS_WABA_ID ||
          phoneNumberId !== LUIS_PHONE_NUMBER_ID
        ) {
          return json(req, 409, {
            ok: false,
            error: "registration_canonical_assets_mismatch",
          });
        }
        const registration = await registerLuisWhatsAppBusinessPhone({
          graphVersion,
          accessToken,
          wabaId,
          phoneNumberId,
          pin: runtimePin,
        });
        if (!registration.activation_complete) {
          return json(req, 200, { ok: registration.registration_accepted, registration });
        }
        // `whatsapp_registered` is intentionally not written here. Its historic
        // meaning is unreliable; the successful fresh CONNECTED read is the sole
        // proof used to enable the canonical connection state.
        if (stored.data?.whatsapp_enabled !== true) {
          const update = await admin.from("org_settings").update({
            whatsapp_enabled: true,
            whatsapp_connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).eq(
            "whatsapp_phone_number_id",
            LUIS_PHONE_NUMBER_ID,
          ).eq("whatsapp_waba_id", LUIS_WABA_ID).select("organization_id")
            .maybeSingle();
          if (update.error || !update.data) {
            return json(req, 500, {
              ok: false,
              registration: {
                ...registration,
                activation_complete: false,
                error: "registration_verification_failed",
              },
              error: "registration_activation_persistence_failed",
            });
          }
        }
        return json(req, 200, { ok: true, registration });
      }
      if (action === "check_whatsapp_activation") {
        const stored = await admin.from("org_settings").select(
          "whatsapp_phone_number_id,whatsapp_waba_id,whatsapp_enabled,whatsapp_access_token",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const phoneNumberId = text(stored.data?.whatsapp_phone_number_id, 100);
        const wabaId = text(stored.data?.whatsapp_waba_id, 100);
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        if (stored.error || !phoneNumberId || !wabaId || !accessToken) {
          return json(req, 200, {
            ok: false,
            activation: {
              organization_id: REFERRAL_HUB_ORGANIZATION_ID,
              phone_number_id: phoneNumberId || null,
              display_phone_number: null,
              meta_status: null,
              activated: false,
              whatsapp_enabled: Boolean(stored.data?.whatsapp_enabled),
              token_configured: Boolean(accessToken),
              error: !accessToken
                ? "credential_not_configured"
                : "canonical_whatsapp_assets_missing",
            },
          });
        }
        const inspection = await inspectWhatsAppActivation({
          graphVersion,
          accessToken,
          phoneNumberId,
          wabaId,
        });
        const validAsset = inspection.phone_access &&
          inspection.waba_relationship === "PASS";
        const connected = inspection.meta_status === "CONNECTED";
        const currentEnabled = stored.data?.whatsapp_enabled === true;
        if (!validAsset || !connected) {
          return json(req, 200, {
            ok: false,
            activation: {
              organization_id: REFERRAL_HUB_ORGANIZATION_ID,
              ...inspection,
              activated: false,
              whatsapp_enabled: currentEnabled,
              token_configured: true,
              error: !validAsset
                ? "activation_asset_validation_failed"
                : "activation_waiting_for_meta",
            },
          });
        }
        if (currentEnabled) {
          return json(req, 200, {
            ok: true,
            activation: {
              organization_id: REFERRAL_HUB_ORGANIZATION_ID,
              ...inspection,
              activated: true,
              whatsapp_enabled: true,
              token_configured: true,
              idempotent: true,
            },
          });
        }
        const update = await admin.from("org_settings").update({
          whatsapp_enabled: true,
          whatsapp_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).eq(
          "whatsapp_phone_number_id",
          phoneNumberId,
        ).eq("whatsapp_waba_id", wabaId).select("organization_id").maybeSingle();
        if (update.error || !update.data) {
          return json(req, 500, {
            ok: false,
            activation: {
              organization_id: REFERRAL_HUB_ORGANIZATION_ID,
              ...inspection,
              activated: false,
              whatsapp_enabled: false,
              token_configured: true,
              error: "activation_persistence_failed",
            },
          });
        }
        return json(req, 200, {
          ok: true,
          activation: {
            organization_id: REFERRAL_HUB_ORGANIZATION_ID,
            ...inspection,
            activated: true,
            whatsapp_enabled: true,
            token_configured: true,
          },
        });
      }
      if (action === "diagnose_test_waba_subscription") {
        const wabaId = text(body.waba_id, 100);
        if (wabaId !== META_TEST_WABA_ID) {
          return json(req, 400, { ok: false, error: "subscription_input_invalid" });
        }
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        if (stored.error || !accessToken) {
          return json(req, 200, {
            ok: false,
            diagnostic: {
              token_configured: false,
              before: "UNKNOWN",
              app_webhook_status: "UNKNOWN",
              callback_url: "UNKNOWN",
              messages_subscription: "UNKNOWN",
              status: "FAILED",
              error: "credential_not_configured",
            },
          });
        }
        const diagnostic = await inspectStoredTestWabaSubscription({
          graphVersion,
          accessToken,
          wabaId,
          expectedAppId: metaAppId,
          expectedWebhookUrl: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/meta-webhook`,
        });
        return json(req, 200, {
          ok: diagnostic.status === "PASS",
          diagnostic: { token_configured: true, ...diagnostic },
        });
      }
      if (action === "subscribe_test_waba") {
        const wabaId = text(body.waba_id, 100);
        if (wabaId !== META_TEST_WABA_ID) {
          return json(req, 400, { ok: false, error: "subscription_input_invalid" });
        }
        const stored = await admin.from("org_settings").select(
          "whatsapp_access_token",
        ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
        const accessToken = text(stored.data?.whatsapp_access_token, 4_000);
        if (stored.error || !accessToken) {
          return json(req, 200, {
            ok: false,
            subscription: {
              before: "UNKNOWN",
              operation: "FAILED",
              app_webhook_status: "UNKNOWN",
              error: "credential_not_configured",
            },
          });
        }
        const subscription = await subscribeStoredTestWaba({
          graphVersion,
          accessToken,
          wabaId,
          expectedAppId: metaAppId,
          expectedWebhookUrl: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/meta-webhook`,
        });
        return json(req, 200, {
          ok: subscription.operation !== "FAILED",
          subscription,
        });
      }
      if (action !== "exchange") {
        return json(req, 400, {
          ok: false,
          error: "invalid_action",
        });
      }

      const code = text(body.code, 2_000);
      const state = text(body.state, 4_000);
      let wabaId = text(body.waba_id, 100);
      let phoneNumberId = text(body.phone_number_id, 100);
      const completion = signupCompletionMetadata(body);
      const exchangeTelemetry = {
        request_received: true,
        authenticated_org: REFERRAL_HUB_ORGANIZATION_ID,
        action: "exchange",
        code_present: Boolean(code),
        waba_id_present: Boolean(wabaId),
        phone_number_id_present: Boolean(phoneNumberId),
        onboarding_event: completion.eventName,
        onboarding_mode: completion.onboardingMode,
        session_info_version: completion.sessionInfoVersion,
        business_app_coexistence_completed:
          completion.businessAppCoexistenceCompleted,
        meta_code_exchange_attempted: false,
        meta_code_exchange_status: "NOT_ATTEMPTED",
        meta_code_exchange_http_status: null as number | null,
        asset_validation: "NOT_ATTEMPTED",
        org_settings_write_attempted: false,
        org_settings_write_succeeded: false,
        whatsapp_enabled_final: null as boolean | null,
      };
      const exchangeFailure = (status: number, error: string) =>
        json(req, status, { ok: false, error, telemetry: exchangeTelemetry });
      console.log("[whatsapp-signup] exchange_received", exchangeTelemetry);
      if (!code) return exchangeFailure(400, "missing_code");
      if (
        !state || !await verifySignupState(state, userId, metaAppSecret)
      ) return exchangeFailure(400, "invalid_state");
      const tokenUrl = buildMetaTokenUrl(
        graphVersion,
        metaAppId,
        metaAppSecret,
        code,
      );
      exchangeTelemetry.meta_code_exchange_attempted = true;
      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json();
      exchangeTelemetry.meta_code_exchange_http_status = tokenRes.status;
      if (!tokenRes.ok || !tokenData.access_token) {
        exchangeTelemetry.meta_code_exchange_status = "FAIL";
        console.error(
          "[whatsapp-signup] meta_oauth_failed",
          safeMetaOAuthDiagnostic(tokenRes.status, tokenData),
        );
        return exchangeFailure(502, "token_exchange_failed");
      }
      exchangeTelemetry.meta_code_exchange_status = "SUCCESS";
      const accessToken = String(tokenData.access_token);

      if (!wabaId) {
        const debugRes = await fetch(
          `https://graph.facebook.com/${graphVersion}/debug_token?input_token=${
            encodeURIComponent(accessToken)
          }`,
          {
            headers: { Authorization: `Bearer ${metaAppId}|${metaAppSecret}` },
          },
        );
        const debugData = await debugRes.json();
        const scope = (debugData?.data?.granular_scopes ?? []).find((
          item: Record<string, unknown>,
        ) => item.permission === "whatsapp_business_management");
        wabaId = text(
          Array.isArray(scope?.target_ids) ? scope.target_ids[0] : "",
          100,
        );
        exchangeTelemetry.waba_id_present = Boolean(wabaId);
      }
      if (wabaId && !phoneNumberId) {
        const phonesRes = await fetch(
          `https://graph.facebook.com/${graphVersion}/${
            encodeURIComponent(wabaId)
          }/phone_numbers?fields=id`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const phonesData = await phonesRes.json();
        phoneNumberId = text(phonesData?.data?.[0]?.id, 100);
        exchangeTelemetry.phone_number_id_present = Boolean(phoneNumberId);
      }
      if (!wabaId || !phoneNumberId) {
        exchangeTelemetry.asset_validation = "FAIL";
        return exchangeFailure(400, "meta_assets_missing");
      }

      const current = await admin.from("org_settings").select(
        "whatsapp_waba_id,whatsapp_phone_number_id,whatsapp_enabled",
      ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
      if (current.error || !current.data) {
        return exchangeFailure(500, "organization_settings_unavailable");
      }
      const replacing = Boolean(
        current.data.whatsapp_phone_number_id &&
          (current.data.whatsapp_phone_number_id !== phoneNumberId ||
            current.data.whatsapp_waba_id !== wabaId),
      );
      if (replacing && body.replace_existing !== true) {
        return exchangeFailure(409, "replacement_confirmation_required");
      }

      const phoneRes = await fetch(
        `https://graph.facebook.com/${graphVersion}/${
          encodeURIComponent(phoneNumberId)
        }?fields=id,display_phone_number,verified_name,code_verification_status,status`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const phoneData = await phoneRes.json();
      if (!phoneRes.ok) {
        exchangeTelemetry.asset_validation = "FAIL";
        return exchangeFailure(502, "registration_check_failed");
      }
      const registrationReady =
        phoneData.code_verification_status === "VERIFIED" &&
        ["CONNECTED", "PENDING"].includes(
          String(phoneData.status ?? "").toUpperCase(),
      );
      if (!registrationReady) {
        exchangeTelemetry.asset_validation = "FAIL";
        return json(req, 409, {
          ok: false,
          error: "registration_failed",
          connection_state: "error_registration",
          telemetry: exchangeTelemetry,
        });
      }

      const subscribeRes = await fetch(
        `https://graph.facebook.com/${graphVersion}/${
          encodeURIComponent(wabaId)
        }/subscribed_apps`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      const subscribeData = await subscribeRes.json();
      if (!subscribeRes.ok || subscribeData?.success !== true) {
        exchangeTelemetry.asset_validation = "FAIL";
        return json(req, 502, {
          ok: false,
          error: "webhook_subscription_failed",
          connection_state: "error_webhook",
          telemetry: exchangeTelemetry,
        });
      }
      exchangeTelemetry.asset_validation = "PASS";

      const expiresIn = Number(tokenData.expires_in ?? 0);
      const expiresAt = expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1_000).toISOString()
        : null;
      const connectionState =
        String(phoneData.status ?? "").toUpperCase() === "CONNECTED"
          ? "connected"
          : "pending_verification";
      exchangeTelemetry.org_settings_write_attempted = true;
      exchangeTelemetry.whatsapp_enabled_final = connectionState === "connected";
      const update = await admin.from("org_settings").update({
        whatsapp_enabled: connectionState === "connected",
        whatsapp_access_token: accessToken,
        whatsapp_phone_number_id: phoneNumberId,
        whatsapp_waba_id: wabaId,
        whatsapp_phone_number: text(phoneData.display_phone_number) || null,
        whatsapp_display_name: text(phoneData.verified_name) || null,
        whatsapp_token_expires_at: expiresAt,
        whatsapp_registered: true,
        whatsapp_webhooks_subscribed: true,
        whatsapp_onboarding_event: completion.eventName,
        whatsapp_onboarding_mode: completion.onboardingMode,
        whatsapp_session_info_version: completion.sessionInfoVersion,
        whatsapp_business_app_coexistence_completed:
          completion.businessAppCoexistenceCompleted,
        whatsapp_connected_at: connectionState === "connected"
          ? new Date().toISOString()
          : null,
        updated_at: new Date().toISOString(),
      }).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).select(
        "organization_id",
      ).maybeSingle();
      if (update.error || !update.data) {
        return exchangeFailure(500, "connection_persistence_failed");
      }
      exchangeTelemetry.org_settings_write_succeeded = true;
      console.log("[whatsapp-signup] exchange_persisted", exchangeTelemetry);
      return json(req, 200, {
        ok: true,
        connection_state: connectionState,
        phone_number: text(phoneData.display_phone_number) || null,
        display_name: text(phoneData.verified_name) || null,
        onboarding: {
          event_name: completion.eventName,
          mode: completion.onboardingMode,
          session_info_version: completion.sessionInfoVersion,
          business_app_coexistence_completed:
            completion.businessAppCoexistenceCompleted,
        },
        replaced: replacing,
        return_to: "/integrations",
        telemetry: exchangeTelemetry,
      });
    } catch (error) {
      const safeMessage = String((error as Error).message).slice(0, 160);
      const missingConfiguration = /^missing_[a-z0-9_]+$/.test(safeMessage);
      console.error("[whatsapp-signup] request_failed", {
        code: missingConfiguration
          ? "missing_configuration"
          : "whatsapp_signup_failed",
      });
      return json(req, 500, {
        ok: false,
        error: missingConfiguration
          ? "missing_configuration"
          : "whatsapp_signup_failed",
      });
    }
  });
}
