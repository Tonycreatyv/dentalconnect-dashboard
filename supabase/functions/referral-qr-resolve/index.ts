import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  controlledDemoQrPhone,
  isReferralQrPublicCode,
  publicReferralQrResolution,
  resolveReferralQrEntry,
} from "../_products/referral-hub/qrEntries.ts";

const origin = "https://referral.creatyv.io";
const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": origin,
  "access-control-allow-headers": "content-type",
};

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "access-control-allow-methods": "POST, OPTIONS" },
    });
  }
  if (request.method !== "POST") return response(405, { available: false });
  try {
    const body = await request.json();
    const publicCode = typeof body?.public_code === "string"
      ? body.public_code.trim()
      : "";
    if (!isReferralQrPublicCode(publicCode)) {
      return response(404, { available: false });
    }
    const client = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const entry = await resolveReferralQrEntry(client, publicCode);
    const demoEnabled =
      String(Deno.env.get("META_WHATSAPP_TEST_DEMO_ENABLED") ?? "")
        .trim().toLowerCase() === "true";
    const demoPhone = entry ? controlledDemoQrPhone(entry, demoEnabled) : null;
    const resolvedEntry = entry && demoPhone
      ? { ...entry, whatsappPhone: demoPhone }
      : entry;
    const result = resolvedEntry
      ? publicReferralQrResolution(resolvedEntry)
      : { available: false };
    return response(resolvedEntry ? 200 : 404, result);
  } catch (error) {
    console.error("[referral-qr-resolve] failed", {
      error: String(error).slice(0, 200),
    });
    return response(500, { available: false });
  }
});
