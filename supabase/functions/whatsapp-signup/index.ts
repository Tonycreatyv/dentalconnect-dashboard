// supabase/functions/whatsapp-signup/index.ts
// Handles the server-side token exchange after a clinic completes
// the WhatsApp Embedded Signup flow in the frontend.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function safeStr(x: unknown, d = ""): string {
  if (typeof x === "string") return x;
  if (x == null) return d;
  return String(x);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE = env("SUPABASE_SERVICE_ROLE_KEY");
    const META_APP_ID = env("META_APP_ID");
    const META_APP_SECRET = env("META_APP_SECRET");
    const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v19.0";

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const code = safeStr(body?.code, "").trim();
    const organizationId = safeStr(body?.organization_id, "").trim();
    const wabaId = safeStr(body?.waba_id, "").trim();
    const phoneNumberId = safeStr(body?.phone_number_id, "").trim();

    if (!code) return json(400, { ok: false, error: "missing_code" });
    if (!organizationId) return json(400, { ok: false, error: "missing_organization_id" });

    // =========================================================================
    // 1. Exchange code for access token
    // =========================================================================
    const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", META_APP_ID);
    tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[whatsapp-signup] token exchange failed:", tokenData);
      return json(500, {
        ok: false,
        error: "token_exchange_failed",
        detail: tokenData?.error?.message ?? "unknown",
      });
    }

    const accessToken = String(tokenData.access_token);
    const tokenType = safeStr(tokenData.token_type, "bearer");
    const expiresIn = Number(tokenData.expires_in ?? 0);
    const expiresAt = expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    console.log("[whatsapp-signup] token exchanged", {
      organizationId,
      wabaId,
      phoneNumberId,
      tokenType,
      expiresIn,
    });

    // =========================================================================
    // 2. If we don't have WABA ID / phone number ID from frontend, fetch them
    // =========================================================================
    let resolvedWabaId = wabaId;
    let resolvedPhoneNumberId = phoneNumberId;
    let phoneNumber = "";
    let displayName = "";

    if (!resolvedWabaId) {
      // Fetch shared WABAs
      const sharedUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/debug_token?input_token=${accessToken}`;
      const debugRes = await fetch(sharedUrl, {
        headers: { Authorization: `Bearer ${META_APP_ID}|${META_APP_SECRET}` },
      });
      const debugData = await debugRes.json();
      const granularScopes = debugData?.data?.granular_scopes ?? [];
      
      for (const scope of granularScopes) {
        if (scope.permission === "whatsapp_business_management" && scope.target_ids?.length > 0) {
          resolvedWabaId = String(scope.target_ids[0]);
          break;
        }
      }
    }

    // Fetch phone numbers for this WABA
    if (resolvedWabaId && !resolvedPhoneNumberId) {
      const phonesUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${resolvedWabaId}/phone_numbers`;
      const phonesRes = await fetch(phonesUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const phonesData = await phonesRes.json();

      if (Array.isArray(phonesData?.data) && phonesData.data.length > 0) {
        resolvedPhoneNumberId = String(phonesData.data[0].id);
        phoneNumber = safeStr(phonesData.data[0].display_phone_number, "");
        displayName = safeStr(phonesData.data[0].verified_name, "");
      }
    }

    // If we have phone number ID, get details
    if (resolvedPhoneNumberId && !phoneNumber) {
      const phoneUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${resolvedPhoneNumberId}`;
      const phoneRes = await fetch(phoneUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const phoneData = await phoneRes.json();
      phoneNumber = safeStr(phoneData?.display_phone_number, "");
      displayName = safeStr(phoneData?.verified_name, displayName);
    }

    if (!resolvedWabaId || !resolvedPhoneNumberId) {
      return json(400, {
        ok: false,
        error: "could_not_resolve_waba_or_phone",
        waba_id: resolvedWabaId || null,
        phone_number_id: resolvedPhoneNumberId || null,
      });
    }

    // =========================================================================
    // 3. Register the phone number (required to start receiving messages)
    // =========================================================================
    const registerUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${resolvedPhoneNumberId}/register`;
    const registerRes = await fetch(registerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        pin: "123456", // Default PIN — clinic can change later
      }),
    });
    const registerData = await registerRes.json();
    const registered = registerRes.ok && registerData?.success === true;

    if (!registered) {
      console.warn("[whatsapp-signup] phone registration warning:", registerData);
      // Don't fail — phone might already be registered
    }

    // =========================================================================
    // 4. Subscribe to webhooks for this WABA
    // =========================================================================
    const subscribeUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${resolvedWabaId}/subscribed_apps`;
    const subscribeRes = await fetch(subscribeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const subscribeData = await subscribeRes.json();
    const subscribed = subscribeRes.ok && subscribeData?.success === true;

    if (!subscribed) {
      console.warn("[whatsapp-signup] webhook subscription warning:", subscribeData);
    }

    // =========================================================================
    // 5. Save everything to org_settings
    // =========================================================================
    const updatePayload: Record<string, unknown> = {
      whatsapp_enabled: true,
      whatsapp_access_token: accessToken,
      whatsapp_phone_number_id: resolvedPhoneNumberId,
      whatsapp_waba_id: resolvedWabaId,
      whatsapp_phone_number: phoneNumber || null,
      whatsapp_display_name: displayName || null,
      whatsapp_token_expires_at: expiresAt,
      whatsapp_registered: registered,
      whatsapp_webhooks_subscribed: subscribed,
      whatsapp_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("org_settings")
      .update(updatePayload)
      .eq("organization_id", organizationId);

    if (updateError) {
      console.error("[whatsapp-signup] org_settings update failed:", updateError);
      return json(500, {
        ok: false,
        error: `db_update_failed: ${updateError.message}`,
      });
    }

    console.log("[whatsapp-signup] success", {
      organizationId,
      wabaId: resolvedWabaId,
      phoneNumberId: resolvedPhoneNumberId,
      phoneNumber,
      registered,
      subscribed,
    });

    return json(200, {
      ok: true,
      waba_id: resolvedWabaId,
      phone_number_id: resolvedPhoneNumberId,
      phone_number: phoneNumber,
      display_name: displayName,
      registered,
      subscribed,
    });
  } catch (error: any) {
    console.error("[whatsapp-signup] error:", error);
    return json(500, { ok: false, error: String(error?.message ?? error) });
  }
});
