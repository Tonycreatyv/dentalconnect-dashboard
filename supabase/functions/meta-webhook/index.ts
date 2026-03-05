/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;

const TESTDENTAL_TAG = "#testdental";
const TESTDENTAL_ORG = "clinic-demo";

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

function parseCsvSet(input: string) {
  const out = new Set<string>();
  for (const raw of String(input ?? "").split(",")) {
    const value = raw.trim();
    if (value) out.add(value);
  }
  return out;
}

function shouldScheduleFollowup(text: string) {
  const t = String(text ?? "").toLowerCase();
  const keys = ["precio", "precios", "costo", "costos", "agenda", "agendar", "cita", "horario"];
  return keys.some((k) => t.includes(k));
}

function waitlistDecision(text: string): "accept" | "decline" | null {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  const yes = ["si", "sí", "yes", "ok", "dale", "me interesa", "confirmo"];
  const no = ["no", "nop", "no gracias", "paso", "ahora no"];
  if (yes.some((k) => t === k || t.includes(k))) return "accept";
  if (no.some((k) => t === k || t.includes(k))) return "decline";
  return null;
}

async function fetchMetaProfile(args: { pageAccessToken: string; psid: string }) {
  if (!args.pageAccessToken || !args.psid) return null;
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/${encodeURIComponent(args.psid)}`);
    url.searchParams.set("fields", "first_name,last_name,profile_pic");
    url.searchParams.set("access_token", args.pageAccessToken);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) return null;
    const first = String(data?.first_name ?? "").trim();
    const last = String(data?.last_name ?? "").trim();
    const full = `${first} ${last}`.trim();
    const profilePic = String(data?.profile_pic ?? "").trim() || null;
    if (!full && !profilePic) return null;
    return { fullName: full || null, profilePic };
  } catch {
    return null;
  }
}

async function resolvePageToken(
  supabase: ReturnType<typeof createClient>,
  organizationId: string
) {
  const kv = await supabase
    .from("org_secrets")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", ["META_PAGE_ACCESS_TOKEN", "PAGE_ACCESS_TOKEN", "META_PAGE_TOKEN"]);
  if (!kv.error && Array.isArray(kv.data)) {
    for (const row of kv.data as any[]) {
      const token = String(row?.value ?? "").replace(/^['"]|['"]$/g, "").trim();
      if (token.length > 50) return token;
    }
  }
  const legacy = await supabase
    .from("org_secrets")
    .select('meta_page_access_token, "META_PAGE_ACCESS_TOKEN"')
    .eq("organization_id", organizationId)
    .maybeSingle();
  return String((legacy.data as any)?.meta_page_access_token ?? (legacy.data as any)?.META_PAGE_ACCESS_TOKEN ?? "").trim();
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
  const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ?? "clinic-demo";
  const RUN_REPLIES_SECRET = Deno.env.get("RUN_REPLIES_SECRET") ?? "";
  const TESTDENTAL_ALLOWED_PSIDS = parseCsvSet(Deno.env.get("TESTDENTAL_ALLOWED_PSIDS") ?? "");

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
      const traceId = providerMid || crypto.randomUUID();
      const rawText = ev.text;
      const hasTestdentalTag = rawText.toLowerCase().includes(TESTDENTAL_TAG);
      const text = rawText.replace(/#testdental/gi, "").trim() || rawText;
      const isoTime = new Date(ev.timestamp).toISOString();

      let organization_id = DEFAULT_ORG;
      const canUseTestdentalOverride = hasTestdentalTag && TESTDENTAL_ALLOWED_PSIDS.has(psid);

      if (canUseTestdentalOverride) {
        organization_id = TESTDENTAL_ORG;
      } else if (pageId) {
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
      console.log("[meta-webhook] inbound", {
        organization_id,
        page_id: pageId,
        psid,
        provider_message_id: providerMid,
        override_testdental: canUseTestdentalOverride,
      });

      const { data: existingLead, error: selErr } = await supabase
        .from("leads")
        .select("id, state, full_name, channel")
        .eq("organization_id", organization_id)
        .eq("channel", channel)
        .eq("channel_user_id", psid)
        .maybeSingle();
      if (selErr) throw selErr;

      const nextState = ensureState(existingLead?.state);
      const existingFullName = String(existingLead?.full_name ?? "").trim();
      const stateName = String(nextState?.name ?? "").trim();
      const hasRealName =
        (existingFullName && !existingFullName.startsWith("Usuario ")) ||
        (stateName && !stateName.startsWith("Usuario "));
      let resolvedName = existingFullName || stateName || `Usuario ${psidSuffix(psid)}`;
      let resolvedProfilePic: string | null = String(nextState?.profile_pic ?? "").trim() || null;

      if (!hasRealName) {
        const token = await resolvePageToken(supabase, organization_id);
        const profile = await fetchMetaProfile({ pageAccessToken: token, psid });
        if (profile?.fullName) resolvedName = profile.fullName;
        if (profile?.profilePic) resolvedProfilePic = profile.profilePic;
      }
      nextState.name = resolvedName;
      if (resolvedProfilePic) nextState.profile_pic = resolvedProfilePic;

      const upsertPayload: Record<string, unknown> = {
        organization_id,
        channel,
        last_channel: channel,
        channel_user_id: psid,
        full_name: resolvedName,
        avatar_url: resolvedProfilePic,
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

      const decision = waitlistDecision(text);
      if (decision) {
        const activeHold = await supabase
          .from("slot_holds")
          .select("id, slot_key, slot_start, slot_end, service_type, hold_until, status")
          .eq("organization_id", organization_id)
          .eq("lead_id", lead.id)
          .eq("slot_hold_scope", "lead")
          .eq("status", "held")
          .gt("hold_until", new Date().toISOString())
          .order("hold_until", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!activeHold.error && activeHold.data?.id) {
          const hold = activeHold.data as any;
          if (decision === "accept") {
            const appointmentInsert = await supabase.from("appointments").insert({
              organization_id,
              lead_id: lead.id,
              start_at: hold.slot_start ?? null,
              starts_at: hold.slot_start ?? null,
              status: "confirmed",
              title: hold.service_type ?? "Cita",
              reason: hold.service_type ?? "Servicio",
              patient_name: resolvedName,
            });
            if (!appointmentInsert.error) {
              await supabase
                .from("slot_holds")
                .update({
                  status: "accepted",
                  updated_at: new Date().toISOString(),
                })
                .eq("organization_id", organization_id)
                .eq("id", hold.id);

              await supabase
                .from("slot_holds")
                .update({
                  status: "expired",
                  updated_at: new Date().toISOString(),
                })
                .eq("organization_id", organization_id)
                .eq("slot_key", hold.slot_key)
                .eq("slot_hold_scope", "lead")
                .neq("id", hold.id)
                .in("status", ["held", "accepted"]);

              const otherLeads = await supabase
                .from("slot_holds")
                .select("lead_id")
                .eq("organization_id", organization_id)
                .eq("slot_key", hold.slot_key)
                .eq("slot_hold_scope", "lead");
              const otherLeadIds = (otherLeads.data ?? [])
                .map((r: any) => String(r?.lead_id ?? ""))
                .filter((id) => id && id !== lead.id);
              if (otherLeadIds.length > 0) {
                const leadsRows = await supabase
                  .from("leads")
                  .select("id, channel, channel_user_id")
                  .eq("organization_id", organization_id)
                  .in("id", otherLeadIds);
                const rows = leadsRows.data ?? [];
                if (rows.length > 0) {
                  await supabase.from("reply_outbox").insert(
                    rows.map((l: any) => ({
                      organization_id,
                      lead_id: l.id,
                      channel: l.channel ?? "messenger",
                      channel_user_id: l.channel_user_id,
                      status: "queued",
                      scheduled_for: new Date().toISOString(),
                      message_text: "Ese turno ya fue tomado. Si querés, te compartimos nuevas opciones.",
                      payload: {
                        source: "waitlist_offer_closed",
                        provider: "meta",
                        text: "Ese turno ya fue tomado. Si querés, te compartimos nuevas opciones.",
                        slot_key: hold.slot_key,
                      },
                    }))
                  );
                }
              }
            }
          } else if (decision === "decline") {
            await supabase
              .from("slot_holds")
              .update({ status: "cancelled", updated_at: new Date().toISOString() })
              .eq("organization_id", organization_id)
              .eq("id", hold.id);
          }
        }
      }

      const cancelFollowupsRes = await supabase
        .from("followup_outbox")
        .update({
          status: "cancelled",
          lock_owner: null,
          locked_at: null,
          updated_at: new Date().toISOString(),
          last_error: "cancelled:user_replied",
        })
        .eq("organization_id", organization_id)
        .eq("lead_id", lead.id)
        .in("status", ["queued", "processing"]);
      if (cancelFollowupsRes.error) {
        const msg = String(cancelFollowupsRes.error.message ?? "");
        if (!msg.toLowerCase().includes("does not exist")) {
          console.log("[meta-webhook] followup_cancel_warn", {
            organization_id,
            lead_id: lead.id,
            error: msg,
          });
        }
      }

      const msgInsert = await supabase
        .from("messages")
        .insert({
          organization_id,
          lead_id: lead.id,
          channel,
          channel_user_id: psid,
          role: "user",
          actor: "user",
          content: text,
          provider_message_id: providerMid,
          inbound_message_id: null,
        })
        .select("id")
        .maybeSingle();
      if (msgInsert.error) {
        const m = String(msgInsert.error.message ?? "");
        if (!m.toLowerCase().includes("duplicate")) throw msgInsert.error;
      }
      const insertedMessageId = (msgInsert.data as any)?.id ?? null;

      const outboxRes = await supabase
        .from("reply_outbox")
        .upsert(
          {
            organization_id,
            lead_id: lead.id,
            channel,
            channel_user_id: psid,
            status: "queued",
            scheduled_for: new Date().toISOString(),
            inbound_message_id: insertedMessageId,
            inbound_provider_message_id: providerMid,
            message_text: text,
            payload: {
              source: "inbound",
              inbound_text: text,
              provider: "meta",
              trace_id: traceId,
              channel: "messenger",
              inbound_provider_message_id: providerMid,
              recipient: { id: psid },
              recipient_id: psid,
            },
          },
          {
            onConflict: "organization_id,inbound_provider_message_id",
            ignoreDuplicates: true,
          }
        )
        .select("id")
        .maybeSingle();
      if (outboxRes.error) {
        const em = String(outboxRes.error.message ?? "").toLowerCase();
        if (!em.includes("duplicate")) throw outboxRes.error;
      } else if (outboxRes.data?.id) {
        created_jobs += 1;
      }
      console.log("[meta-webhook] enqueue", {
        organization_id,
        message_id: insertedMessageId,
        outbox_id: outboxRes.data?.id ?? null,
        psid,
        provider_message_id: providerMid,
        source: "meta-webhook",
      });

      if (shouldScheduleFollowup(text)) {
        const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const followupRes = await supabase
          .from("followup_outbox")
          .upsert(
            {
              organization_id,
              lead_id: lead.id,
              channel_user_id: psid,
              provider: "meta",
              reason: "lead_silent",
              step: 1,
              max_steps: 3,
              due_at: dueAt,
              status: "queued",
              payload: {
                provider: "meta",
                source: "auto_followup",
                reason: "lead_silent",
                step: 1,
              },
            },
            {
              onConflict: "organization_id,lead_id,reason,step",
              ignoreDuplicates: true,
            }
          )
          .select("id")
          .maybeSingle();
        if (followupRes.error) {
          const msg = String(followupRes.error.message ?? "");
          if (!msg.toLowerCase().includes("duplicate") && !msg.toLowerCase().includes("does not exist")) {
            console.log("[meta-webhook] followup_enqueue_warn", {
              organization_id,
              lead_id: lead.id,
              error: msg,
            });
          }
        } else {
          console.log("[meta-webhook] followup_queued", {
            organization_id,
            lead_id: lead.id,
            followup_id: followupRes.data?.id ?? null,
            due_at: dueAt,
          });
        }
      }

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
