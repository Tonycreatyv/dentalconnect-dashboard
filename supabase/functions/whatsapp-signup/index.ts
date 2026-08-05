import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  createSignupState,
  mayManageWhatsApp,
  REFERRAL_HUB_ORGANIZATION_ID,
  verifySignupState,
} from "./contract.ts";

const ALLOWED_ORIGINS = new Set(["https://referral.creatyv.io"]);

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

const META_REDIRECT_HOST = "staticxx.facebook.com";
const META_REDIRECT_PATH = "/x/connect/xd_arbiter/";

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
  redirectUri: string,
) {
  const tokenUrl = new URL(
    `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
  );
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  return tokenUrl;
}

export function validateMetaRedirectUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    return null;
  }
  if (value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.hostname !== META_REDIRECT_HOST ||
      url.pathname !== META_REDIRECT_PATH
    ) return null;
    if (
      url.username || url.password || url.port || !url.pathname.endsWith("/")
    ) return null;
    const queryEntries = [...url.searchParams.entries()];
    if (
      queryEntries.length !== 1 || queryEntries[0][0] !== "version" ||
      !/^\d{1,4}$/.test(queryEntries[0][1])
    ) return null;
    if (!url.hash || url.hash.length <= 1 || url.hash.length - 1 > 2048) {
      return null;
    }
    return value;
  } catch {
    return null;
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
      const action = text(body.action, 30) || "exchange";
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
      if (action !== "exchange") {
        return json(req, 400, {
          ok: false,
          error: "invalid_action",
        });
      }

      const code = text(body.code, 2_000);
      const state = text(body.state, 4_000);
      if (body.redirect_uri !== undefined || body.redirectUri !== undefined) {
        return json(req, 400, {
          ok: false,
          error: "invalid_meta_redirect_uri",
        });
      }
      const metaRedirectUri = validateMetaRedirectUri(body.meta_redirect_uri);
      if (!code) return json(req, 400, { ok: false, error: "missing_code" });
      if (
        !state || !await verifySignupState(state, userId, metaAppSecret)
      ) return json(req, 400, { ok: false, error: "invalid_state" });
      if (!metaRedirectUri) {
        return json(req, 400, {
          ok: false,
          error: "invalid_meta_redirect_uri",
        });
      }

      const tokenUrl = buildMetaTokenUrl(
        graphVersion,
        metaAppId,
        metaAppSecret,
        code,
        metaRedirectUri,
      );
      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        console.error(
          "[whatsapp-signup] meta_oauth_failed",
          safeMetaOAuthDiagnostic(tokenRes.status, tokenData),
        );
        return json(req, 502, { ok: false, error: "token_exchange_failed" });
      }
      const accessToken = String(tokenData.access_token);

      let wabaId = text(body.waba_id, 100);
      let phoneNumberId = text(body.phone_number_id, 100);
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
      }
      if (!wabaId || !phoneNumberId) {
        return json(req, 400, { ok: false, error: "meta_assets_missing" });
      }

      const current = await admin.from("org_settings").select(
        "whatsapp_waba_id,whatsapp_phone_number_id,whatsapp_enabled",
      ).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).maybeSingle();
      if (current.error || !current.data) {
        return json(req, 500, {
          ok: false,
          error: "organization_settings_unavailable",
        });
      }
      const replacing = Boolean(
        current.data.whatsapp_phone_number_id &&
          (current.data.whatsapp_phone_number_id !== phoneNumberId ||
            current.data.whatsapp_waba_id !== wabaId),
      );
      if (replacing && body.replace_existing !== true) {
        return json(req, 409, {
          ok: false,
          error: "replacement_confirmation_required",
        });
      }

      const phoneRes = await fetch(
        `https://graph.facebook.com/${graphVersion}/${
          encodeURIComponent(phoneNumberId)
        }?fields=id,display_phone_number,verified_name,code_verification_status,status`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const phoneData = await phoneRes.json();
      if (!phoneRes.ok) {
        return json(req, 502, {
          ok: false,
          error: "registration_check_failed",
        });
      }
      const registrationReady =
        phoneData.code_verification_status === "VERIFIED" &&
        ["CONNECTED", "PENDING"].includes(
          String(phoneData.status ?? "").toUpperCase(),
        );
      if (!registrationReady) {
        return json(req, 409, {
          ok: false,
          error: "registration_failed",
          connection_state: "error_registration",
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
        return json(req, 502, {
          ok: false,
          error: "webhook_subscription_failed",
          connection_state: "error_webhook",
        });
      }

      const expiresIn = Number(tokenData.expires_in ?? 0);
      const expiresAt = expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1_000).toISOString()
        : null;
      const connectionState =
        String(phoneData.status ?? "").toUpperCase() === "CONNECTED"
          ? "connected"
          : "pending_verification";
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
        whatsapp_connected_at: connectionState === "connected"
          ? new Date().toISOString()
          : null,
        updated_at: new Date().toISOString(),
      }).eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID).select(
        "organization_id",
      ).maybeSingle();
      if (update.error || !update.data) {
        return json(req, 500, {
          ok: false,
          error: "connection_persistence_failed",
        });
      }
      return json(req, 200, {
        ok: true,
        connection_state: connectionState,
        phone_number: text(phoneData.display_phone_number) || null,
        display_name: text(phoneData.verified_name) || null,
        replaced: replacing,
        return_to: "/integrations",
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
