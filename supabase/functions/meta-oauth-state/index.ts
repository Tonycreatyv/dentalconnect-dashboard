import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGIN = "https://dental.creatyv.io";
const ALLOWED_PRODUCTION_ORIGINS = new Set([
  ALLOWED_ORIGIN,
  "https://referral.creatyv.io",
]);
const DEV_ORIGINS = new Set(["http://localhost:5173"]);

function resolveOrigin(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  if (!origin) return ALLOWED_ORIGIN;
  if (ALLOWED_PRODUCTION_ORIGINS.has(origin)) return origin;
  if (DEV_ORIGINS.has(origin)) return origin;
  return ALLOWED_ORIGIN;
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "content-type": "application/json" },
  });
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

async function authorizeOrganizationAccess(
  supabase: any,
  req: Request,
  organizationId: string,
) {
  const bearer = String(req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const userResult = await supabase.auth.getUser(bearer);
  const userId = String(userResult.data?.user?.id ?? "");
  if (!userId) return false;
  const [membership, profile] = await Promise.all([
    supabase.from("org_members").select("organization_id").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle(),
    supabase.from("user_profiles").select("is_admin").eq("user_id", userId).maybeSingle(),
  ]);
  return Boolean(membership.data?.organization_id || profile.data?.is_admin === true);
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(input: Uint8Array) {
  const str = btoa(String.fromCharCode(...input));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256Base64Url(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed", details: "Only POST is supported." });

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE = env("SUPABASE_SERVICE_ROLE_KEY");
    const META_STATE_SECRET = env("META_STATE_SECRET");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const organizationId = String(body?.organization_id ?? "").trim();
    if (!organizationId) {
      return json(req, 400, { error: "missing_organization_id", details: "organization_id es requerido." });
    }
    if (!await authorizeOrganizationAccess(supabase, req, organizationId)) {
      return json(req, 403, { error: "organization_access_denied", details: "No tienes acceso a esta organización." });
    }

    const exists = await supabase
      .from("org_settings")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (exists.error) {
      return json(req, 500, { error: "org_lookup_failed", details: exists.error.message });
    }

    const payload = {
      org: organizationId,
      ts: Date.now(),
      nonce: randomNonce(),
    };

    const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await hmacSha256Base64Url(META_STATE_SECRET, payloadB64);
    const state = `${payloadB64}.${sig}`;

    return json(req, 200, { ok: true, state });
  } catch (error: any) {
    const details = String(error?.message ?? error);
    if (details.includes("META_STATE_SECRET")) {
      return json(req, 500, {
        error: "missing_META_STATE_SECRET",
        details: "Configura META_STATE_SECRET en Supabase Secrets",
      });
    }
    return json(req, 500, {
      error: "meta_oauth_state_unhandled_error",
      details,
    });
  }
});
