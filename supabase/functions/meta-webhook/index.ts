/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ensureState(state: any): any {
  const s = state && typeof state === "object" ? state : {};
  if (!s.stage) s.stage = "collecting";
  if (!("full_name" in s)) s.full_name = null;
  if (!("service" in s)) s.service = null;
  if (!("phone" in s)) s.phone = null;
  if (!("availability" in s)) s.availability = null;
  if (!("asked" in s)) s.asked = { full_name: false, service: false, phone: false, availability: false };
  if (!("last_bot_step" in s)) s.last_bot_step = null;
  if (!("intent" in s)) s.intent = null;
  if (!("last_seen_inbound_message_id" in s)) s.last_seen_inbound_message_id = null;
  return s;
}

function psidSuffix(psid: string) {
  const digits = String(psid ?? "").replace(/\D/g, "");
  if (!digits) return "0000";
  return digits.slice(-4).padStart(4, "0");
}

type MessengerEvent = {
  page_id: string;
  psid: string;
  mid: string;
  text: string;
  timestamp: number;
};

function extractMessengerTextEvents(body: any): MessengerEvent[] {
  const events: MessengerEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const pageId = String(entry?.id ?? "");
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const m of messaging) {
      const psid = m?.sender?.id;
      const msg = m?.message;
      const text = msg?.text;
      const mid = msg?.mid;
      const ts = m?.timestamp ?? Date.now();

      if (!psid || !mid) continue;
      if (msg?.is_echo) continue;
      if (typeof text !== "string" || !text.trim()) continue;

      events.push({
        page_id: pageId,
        psid: String(psid),
        mid: String(mid),
        text: text.trim(),
        timestamp: Number(ts),
      });
    }
  }
  return events;
}

async function fetchMetaProfileName(args: { pageAccessToken: string; psid: string }) {
  if (!args.pageAccessToken || !args.psid) return null;
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/${encodeURIComponent(args.psid)}`);
    url.searchParams.set("fields", "first_name,last_name");
    url.searchParams.set("access_token", args.pageAccessToken);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) return null;
    const first = String(data?.first_name ?? "").trim();
    const last = String(data?.last_name ?? "").trim();
    const full = `${first} ${last}`.trim();
    return full || null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
  const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ?? "clinic-demo";
  const RUN_REPLIES_SECRET = Deno.env.get("RUN_REPLIES_SECRET") ?? "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !META_VERIFY_TOKEN) {
    return json(200, { ok: false, error: "missing_env" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === META_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

    const body = await req.json();
    const channel = "messenger";
    const events = extractMessengerTextEvents(body);
    if (!events.length) return json(200, { ok: true, received: 0, organization_ids: [] });

    let received = 0;
    let created_jobs = 0;
    let updated_leads = 0;
    const orgIds = new Set<string>();

    for (const ev of events) {
      received++;

      const pageId = ev.page_id;
      const psid = ev.psid;
      const providerMid = ev.mid;
      const text = ev.text;
      const isoTime = new Date(ev.timestamp).toISOString();

      let organization_id = DEFAULT_ORG;
      if (pageId) {
        const orgLookup = await supabase
          .from("org_settings")
          .select("organization_id")
          .eq("meta_page_id", pageId)
          .eq("messenger_enabled", true)
          .maybeSingle();
        if (!orgLookup.error && orgLookup.data?.organization_id) {
          organization_id = String(orgLookup.data.organization_id);
        }
      }
      orgIds.add(organization_id);

      const { data: existingLead, error: selErr } = await supabase
        .from("leads")
        .select("id, state")
        .eq("organization_id", organization_id)
        .eq("channel", channel)
        .eq("channel_user_id", psid)
        .maybeSingle();
      if (selErr) throw selErr;

      const nextState = ensureState(existingLead?.state);
      const alreadyHasName = typeof nextState?.name === "string" && nextState.name.trim().length > 0;
      let resolvedName = alreadyHasName ? String(nextState.name).trim() : `Usuario ${psidSuffix(psid)}`;

      if (!alreadyHasName) {
        const tokenRes = await supabase
          .from("org_secrets")
          .select('meta_page_access_token, "META_PAGE_ACCESS_TOKEN"')
          .eq("organization_id", organization_id)
          .maybeSingle();
        const token = String((tokenRes.data as any)?.meta_page_access_token ?? (tokenRes.data as any)?.META_PAGE_ACCESS_TOKEN ?? "");
        const profileName = await fetchMetaProfileName({ pageAccessToken: token, psid });
        if (profileName) resolvedName = profileName;
      }
      nextState.name = resolvedName;

      const upsertPayload: Record<string, unknown> = {
        organization_id,
        channel,
        channel_user_id: psid,
        full_name: resolvedName,
        last_message_preview: text.slice(0, 140),
        last_message_at: isoTime,
        state: nextState,
      };
      if (!existingLead?.id) upsertPayload["handoff_to_human"] = false;

      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .upsert(upsertPayload, { onConflict: "organization_id,channel,channel_user_id" })
        .select("id")
        .single();
      if (leadErr) throw leadErr;
      updated_leads++;

      const { error: msgErr } = await supabase
        .from("messages")
        .insert({
          organization_id,
          lead_id: lead.id,
          channel,
          role: "user",
          actor: "user",
          content: text,
          provider_message_id: providerMid,
          inbound_message_id: null,
        });
      if (msgErr) {
        const m = String(msgErr.message ?? "");
        if (!m.toLowerCase().includes("duplicate")) throw msgErr;
      }

      const payload = {
        organization_id,
        lead_id: lead.id,
        channel,
        channel_user_id: psid,
        inbound_provider_message_id: providerMid,
        inbound_text: text,
      };

      const { error: outErr } = await supabase.rpc("enqueue_reply_job", {
        p_organization_id: organization_id,
        p_lead_id: lead.id,
        p_channel: channel,
        p_channel_user_id: psid,
        p_inbound_provider_message_id: providerMid,
        p_payload: payload,
      });
      if (outErr) throw outErr;
      created_jobs++;

      if (RUN_REPLIES_SECRET) {
        const RUN_REPLIES_URL = `${SUPABASE_URL}/functions/v1/run-replies`;
        await fetch(RUN_REPLIES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-run-replies-secret": RUN_REPLIES_SECRET,
          },
          body: JSON.stringify({ organization_id, limit: 5 }),
        });
      }
    }

    return json(200, {
      ok: true,
      organization_ids: Array.from(orgIds),
      received,
      updated_leads,
      created_jobs,
      demo_trigger_enabled: Boolean(RUN_REPLIES_SECRET),
    });
  } catch (err: any) {
    console.error("[meta-webhook] error:", err);
    return json(200, { ok: false, error: String(err?.message ?? err) });
  }
});
