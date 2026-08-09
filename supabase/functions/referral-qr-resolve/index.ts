import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
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
    const publicCode = typeof body?.public_code === "string" ? body.public_code.trim() : "";
    if (!isReferralQrPublicCode(publicCode)) return response(404, { available: false });
    const client = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const entry = await resolveReferralQrEntry(client, publicCode);
    return response(entry ? 200 : 404, entry ? publicReferralQrResolution(entry) : { available: false });
  } catch (error) {
    console.error("[referral-qr-resolve] failed", { error: String(error).slice(0, 200) });
    return response(500, { available: false });
  }
});
