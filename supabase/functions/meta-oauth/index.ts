import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGIN = "https://dental.creatyv.io";
const DEV_ORIGINS = new Set(["http://localhost:5173"]);

function resolveOrigin(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  if (!origin) return ALLOWED_ORIGIN;
  if (origin === ALLOWED_ORIGIN) return origin;
  if (DEV_ORIGINS.has(origin)) return origin;
  return ALLOWED_ORIGIN;
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function normalizeBaseUrl(url: string) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
};

function toBase64Url(input: Uint8Array) {
  const str = btoa(String.fromCharCode(...input));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
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

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySignedState(state: string, secret: string): Promise<{ org: string; ts: number; nonce: string }> {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 2) throw new Error("invalid_state");
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) throw new Error("invalid_state");

  const expected = await hmacSha256Base64Url(secret, payloadB64);
  if (!timingSafeEqual(expected, sig)) throw new Error("invalid_state");

  const payloadRaw = new TextDecoder().decode(fromBase64Url(payloadB64));
  const payload = JSON.parse(payloadRaw ?? "{}") as { org?: string; ts?: number; nonce?: string };

  const org = String(payload.org ?? "").trim();
  const ts = Number(payload.ts ?? 0);
  const nonce = String(payload.nonce ?? "").trim();

  if (!org || !nonce || !Number.isFinite(ts) || ts <= 0) throw new Error("invalid_state");
  const ageMs = Date.now() - ts;
  if (ageMs < -2 * 60 * 1000 || ageMs > 30 * 60 * 1000) throw new Error("invalid_state");

  return { org, ts, nonce };
}

async function exchangeCodeForUserToken(args: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}) {
  const url = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  url.searchParams.set("client_id", args.appId);
  url.searchParams.set("client_secret", args.appSecret);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("code", args.code);

  const response = await fetch(url.toString());
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "meta_exchange_failed");
  }
  return String(data.access_token ?? "");
}

async function fetchPages(userToken: string): Promise<MetaPage[]> {
  const url = new URL("https://graph.facebook.com/v19.0/me/accounts");
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", userToken);

  const response = await fetch(url.toString());
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "meta_pages_failed");
  }

  const pages = Array.isArray(data?.data) ? data.data : [];
  return pages
    .filter((p: any) => p?.id && p?.access_token)
    .map((p: any) => ({
      id: String(p.id),
      name: String(p.name ?? "Página"),
      access_token: String(p.access_token),
    }));
}

async function upsertOrgSecretsWithFallback(
  supabase: ReturnType<typeof createClient>,
  args: { organizationId: string; pageId: string; pageAccessToken: string; now: string }
) {
  const candidates: Record<string, string>[] = [
    {
      organization_id: args.organizationId,
      meta_page_id: args.pageId,
      meta_page_access_token: args.pageAccessToken,
      updated_at: args.now,
    },
    {
      organization_id: args.organizationId,
      meta_page_id: args.pageId,
      META_PAGE_ACCESS_TOKEN: args.pageAccessToken,
      updated_at: args.now,
    },
    {
      organization_id: args.organizationId,
      meta_page_id: args.pageId,
      updated_at: args.now,
    },
  ];

  let lastError: { message: string; isSchemaCache: boolean } | null = null;

  for (const payload of candidates) {
    const res = await supabase.from("org_secrets").upsert(payload as any, { onConflict: "organization_id" });
    if (!res.error) {
      const tokenStored = "meta_page_access_token" in payload || "META_PAGE_ACCESS_TOKEN" in payload;
      return { ok: true as const, tokenStored };
    }
    const isMissingColumn =
      res.error.message.includes("Could not find the") && res.error.message.includes("column") && res.error.message.includes("schema cache");
    lastError = { message: res.error.message, isSchemaCache: isMissingColumn };
    if (!isMissingColumn) {
      break;
    }
  }

  return {
    ok: false as const,
    error: lastError?.message ?? "org_secrets_upsert_failed",
    isSchemaCache: lastError?.isSchemaCache ?? false,
  };
}

async function transferMetaPageLinkIfNeeded(
  supabase: ReturnType<typeof createClient>,
  args: { organizationId: string; pageId: string; now: string }
) {
  const linkedRes = await supabase
    .from("org_settings")
    .select("organization_id")
    .eq("meta_page_id", args.pageId)
    .neq("organization_id", args.organizationId);

  if (linkedRes.error) {
    return { ok: false as const, error: linkedRes.error.message };
  }

  const linkedOrgIds = (Array.isArray(linkedRes.data) ? linkedRes.data : [])
    .map((row: any) => String(row?.organization_id ?? "").trim())
    .filter(Boolean);

  for (const linkedOrgId of linkedOrgIds) {
    const releaseRes = await supabase
      .from("org_settings")
      .update({
        meta_page_id: null,
        messenger_enabled: false,
        meta_connected_at: null,
        updated_at: args.now,
      })
      .eq("organization_id", linkedOrgId);

    if (releaseRes.error) {
      return { ok: false as const, error: releaseRes.error.message };
    }
  }

  return { ok: true as const, transferredFrom: linkedOrgIds };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed", details: "Only POST is supported." });

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE = env("SUPABASE_SERVICE_ROLE_KEY");
    const META_APP_ID = env("META_APP_ID");
    const META_APP_SECRET = env("META_APP_SECRET");
    const META_STATE_SECRET = env("META_STATE_SECRET");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "exchange_and_save");

    const code = String(body?.code ?? "");
    const redirectUriRaw = String(body?.redirect_uri ?? body?.redirectUri ?? "");
    const redirectUri = normalizeBaseUrl(redirectUriRaw);
    const stateRaw = String(body?.state ?? "");
    let organizationId = "";

    const actionNeedsRedirectUri = action === "exchange" || action === "exchange_and_save";
    if (actionNeedsRedirectUri && !redirectUri) {
      return json(req, 400, {
        error: "missing_redirect_uri",
        details: "redirectUri (or redirect_uri) es requerido.",
      });
    }

    try {
      const parsedState = await verifySignedState(stateRaw, META_STATE_SECRET);
      organizationId = parsedState.org;
    } catch {
      return json(req, 400, { error: "invalid_state", details: "State inválido o expirado." });
    }

    if (action === "exchange") {
      if (!code || !organizationId) {
        return json(req, 400, { error: "missing_code_or_org", details: "code y state son requeridos." });
      }

      const userToken = await exchangeCodeForUserToken({
        appId: META_APP_ID,
        appSecret: META_APP_SECRET,
        redirectUri,
        code,
      });
      const pages = await fetchPages(userToken);

      if (!pages.length) {
        await supabase.from("org_settings").upsert(
          {
            organization_id: organizationId,
            business_type: "dental",
            messenger_enabled: false,
            meta_last_error: "No se encontraron páginas disponibles en Meta.",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" }
        );
      }

      return json(req, 200, {
        ok: true,
        pages: pages.map((p) => ({ id: p.id, name: p.name, access_token: p.access_token })),
      });
    }

    if (action === "exchange_and_save") {
      if (!code || !organizationId || !stateRaw) {
        return json(req, 400, {
          error: "missing_code_state_or_org",
          details: "code y state son requeridos.",
        });
      }

      const userToken = await exchangeCodeForUserToken({
        appId: META_APP_ID,
        appSecret: META_APP_SECRET,
        redirectUri,
        code,
      });
      const pages = await fetchPages(userToken);

      if (!pages.length) {
        return json(req, 400, {
          error: "no_pages_available",
          details: "No se encontraron páginas disponibles en Meta.",
        });
      }

      const page = pages[0];
      const now = new Date().toISOString();
      const displayName = page.name || organizationId;

      const transferRes = await transferMetaPageLinkIfNeeded(supabase, {
        organizationId,
        pageId: page.id,
        now,
      });
      if (!transferRes.ok) {
        return json(req, 500, { error: "meta_page_transfer_failed", details: transferRes.error });
      }

      const settingsPayload = {
        organization_id: organizationId,
        business_type: "dental",
        meta_page_id: page.id,
        messenger_enabled: true,
        meta_connected_at: now,
        meta_last_error: null,
        updated_at: now,
        brand_name: displayName,
      };

      let settingsRes = await supabase.from("org_settings").upsert(settingsPayload, { onConflict: "organization_id" });
      const isUniqueConflict =
        settingsRes.error &&
        ((settingsRes.error as any)?.code === "23505" || settingsRes.error.message.includes("org_settings_meta_page_id_unique"));
      if (isUniqueConflict) {
        const retryTransferRes = await transferMetaPageLinkIfNeeded(supabase, {
          organizationId,
          pageId: page.id,
          now,
        });
        if (!retryTransferRes.ok) {
          return json(req, 500, { error: "meta_page_transfer_failed", details: retryTransferRes.error });
        }
        settingsRes = await supabase.from("org_settings").upsert(settingsPayload, { onConflict: "organization_id" });
      }
      if (settingsRes.error) {
        return json(req, 500, { error: "settings_upsert_failed", details: settingsRes.error.message });
      }

      const secretRes = await upsertOrgSecretsWithFallback(supabase, {
        organizationId,
        pageId: page.id,
        pageAccessToken: page.access_token,
        now,
      });
      if (!secretRes.ok) {
        if (secretRes.isSchemaCache) {
          const warningCode = "org_secrets_schema_mismatch";
          await supabase.from("org_settings").upsert(
            {
              organization_id: organizationId,
              business_type: "dental",
              messenger_enabled: true,
              meta_last_error: warningCode,
              updated_at: now,
            },
            { onConflict: "organization_id" }
          );
          return json(req, 200, {
            ok: true,
            connected: true,
            page_id: page.id,
            page_name: displayName,
            token_saved: false,
            warning: warningCode,
          });
        }
        await supabase.from("org_settings").upsert(
          {
            organization_id: organizationId,
            business_type: "dental",
            messenger_enabled: false,
            meta_last_error: secretRes.error,
            updated_at: now,
          },
          { onConflict: "organization_id" }
        );
        return json(req, 500, { error: "org_secrets_upsert_failed", details: secretRes.error });
      }

      return json(req, 200, {
        ok: true,
        connected: true,
        page_id: page.id,
        page_name: displayName,
        token_saved: secretRes.tokenStored,
      });
    }

    if (action === "save_page") {
      const pageId = String(body?.page_id ?? "");
      const pageName = String(body?.page_name ?? "");
      const pageAccessToken = String(body?.page_access_token ?? "");

      if (!organizationId || !pageId || !pageAccessToken) {
        return json(req, 400, {
          error: "missing_page_selection",
          details: "organization_id, page_id and page_access_token are required.",
        });
      }

      const now = new Date().toISOString();
      const displayName = pageName || organizationId;

      const transferRes = await transferMetaPageLinkIfNeeded(supabase, {
        organizationId,
        pageId,
        now,
      });
      if (!transferRes.ok) {
        return json(req, 500, { error: "meta_page_transfer_failed", details: transferRes.error });
      }

      const settingsPayload = {
        organization_id: organizationId,
        business_type: "dental",
        meta_page_id: pageId,
        messenger_enabled: true,
        meta_connected_at: now,
        meta_last_error: null,
        updated_at: now,
        brand_name: displayName,
      };

      let settingsRes = await supabase.from("org_settings").upsert(settingsPayload, { onConflict: "organization_id" });
      const isUniqueConflict =
        settingsRes.error &&
        ((settingsRes.error as any)?.code === "23505" || settingsRes.error.message.includes("org_settings_meta_page_id_unique"));
      if (isUniqueConflict) {
        const retryTransferRes = await transferMetaPageLinkIfNeeded(supabase, {
          organizationId,
          pageId,
          now,
        });
        if (!retryTransferRes.ok) {
          return json(req, 500, { error: "meta_page_transfer_failed", details: retryTransferRes.error });
        }
        settingsRes = await supabase.from("org_settings").upsert(settingsPayload, { onConflict: "organization_id" });
      }
      if (settingsRes.error) {
        return json(req, 500, { error: "settings_upsert_failed", details: settingsRes.error.message });
      }

      const secretRes = await upsertOrgSecretsWithFallback(supabase, {
        organizationId,
        pageId,
        pageAccessToken,
        now,
      });
      if (!secretRes.ok) {
        if (secretRes.isSchemaCache) {
          const warningCode = "org_secrets_schema_mismatch";
          await supabase.from("org_settings").upsert(
            {
              organization_id: organizationId,
              business_type: "dental",
              messenger_enabled: true,
              meta_last_error: warningCode,
              updated_at: now,
            },
            { onConflict: "organization_id" }
          );
          return json(req, 200, { ok: true, page_id: pageId, token_saved: false, warning: warningCode });
        }
        await supabase.from("org_settings").upsert(
          {
            organization_id: organizationId,
            business_type: "dental",
            messenger_enabled: false,
            meta_last_error: secretRes.error,
            updated_at: now,
          },
          { onConflict: "organization_id" }
        );
        return json(req, 500, { error: "org_secrets_upsert_failed", details: secretRes.error });
      }

      return json(req, 200, { ok: true, page_id: pageId, token_saved: secretRes.tokenStored });
    }

    return json(req, 400, {
      error: "unknown_action",
      details: "Use action=exchange_and_save, action=exchange, or action=save_page.",
    });
  } catch (error: any) {
    return json(req, 500, {
      error: "meta_oauth_unhandled_error",
      details: String(error?.message ?? error),
    });
  }
});
