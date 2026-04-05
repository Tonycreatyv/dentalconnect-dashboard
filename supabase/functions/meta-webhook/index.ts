/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { ensureConversationState, resolveMode, stripTestDentalTag } from "../_shared/conversationEngine.ts";

type Json = Record<string, unknown>;

const TESTDENTAL_TAG = "#testdental";

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
  if (!("collected_name" in s)) s.collected_name = false;
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

type InboundEvent = {
  channel: "messenger" | "whatsapp";
  page_id?: string;
  phone_number_id?: string;
  sender_id: string;
  mid: string;
  text: string;
  timestamp: number;
  sender_name?: string | null;
};

function normalizePsid(input: unknown) {
  if (typeof input === "string") {
    return input.trim();
  }
  if (typeof input === "number") {
    return String(input).trim();
  }
  return "";
}

function collectTesterPsids(target: Set<string>, raw: unknown) {
  if (!raw) return;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizePsid(item);
      if (normalized) target.add(normalized);
    }
    return;
  }
  const asString = String(raw).trim();
  if (!asString) return;
  try {
    const parsed = JSON.parse(asString);
    if (Array.isArray(parsed)) {
      collectTesterPsids(target, parsed);
      return;
    }
  } catch {
    // fall back to comma/space split
  }
  for (const chunk of asString.split(/[\\s,]+/)) {
    const normalized = chunk.trim();
    if (normalized) target.add(normalized);
  }
}

function extractMessengerTextEvents(body: any): InboundEvent[] {
  const events: InboundEvent[] = [];
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
        channel: "messenger",
        page_id: pageId,
        sender_id: String(psid),
        mid: String(mid),
        text: text.trim(),
        timestamp: Number(ts),
      });
    }
  }
  return events;
}

function extractWhatsAppTextEvents(body: any): InboundEvent[] {
  const events: InboundEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (String(change?.field ?? "") !== "messages") continue;
      const value = change?.value ?? {};
      const metadata = value?.metadata ?? {};
      const phoneNumberId = safeString(metadata?.phone_number_id);
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      for (const msg of messages) {
        const senderId = safeString(msg?.from);
        const mid = safeString(msg?.id);
        const text = safeString(msg?.text?.body);
        if (!senderId || !mid || !text) continue;
        const contact = contacts.find((item: any) => safeString(item?.wa_id) === senderId) ?? contacts[0];
        events.push({
          channel: "whatsapp",
          phone_number_id: phoneNumberId,
          sender_id: senderId,
          mid,
          text,
          timestamp: Number(msg?.timestamp ? Number(msg.timestamp) * 1000 : Date.now()),
          sender_name: safeString(contact?.profile?.name) || null,
        });
      }
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

function safeString(input: unknown) {
  if (typeof input === "string") return input.trim();
  if (typeof input === "number") return String(input).trim();
  return "";
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

async function fetchMetaProfileDetails(args: { pageAccessToken: string; psid: string }) {
  if (!args.pageAccessToken || !args.psid) return null;
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/${encodeURIComponent(args.psid)}`);
    url.searchParams.set("fields", "first_name,last_name,profile_pic,locale,timezone,gender");
    url.searchParams.set("access_token", args.pageAccessToken);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) return null;
    const first = String(data?.first_name ?? "").trim() || null;
    const last = String(data?.last_name ?? "").trim() || null;
    const locale = String(data?.locale ?? "").trim() || null;
    const timezone = typeof data?.timezone === "number" ? String(data?.timezone) : null;
    const gender = String(data?.gender ?? "").trim() || null;
    const profilePic = String(data?.profile_pic ?? "").trim() || null;
    const full = [first, last].filter(Boolean).join(" ").trim() || null;
    if (!first && !last && !profilePic && !full) return null;
    return {
      firstName: first,
      lastName: last,
      fullName: full,
      profilePic,
      locale,
      timezone,
      gender,
    };
  } catch {
    return null;
  }
}

async function resolvePageToken(
  supabase: ReturnType<typeof createClient>,
  organizationId: string
) {
  const { data } = await supabase
    .from("org_settings")
    .select("meta_page_access_token")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return String(data?.meta_page_access_token ?? "").trim();
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
    const events = [
      ...extractMessengerTextEvents(body),
      ...extractWhatsAppTextEvents(body),
    ];
    if (!events.length) return json(200, { ok: true, received: 0, organization_ids: [] });

    let received = 0;
    let created_jobs = 0;
    let updated_leads = 0;
    const orgIds = new Set<string>();

    for (const ev of events) {
      received++;

      const channel = ev.channel;
      const pageId = ev.page_id ?? "";
      const phoneNumberId = ev.phone_number_id ?? "";
      const senderId = ev.sender_id;
      const providerMid = ev.mid;
      const traceId = providerMid || crypto.randomUUID();
      const rawText = ev.text;
      const lowerText = rawText.toLowerCase();
      const hasTestdentalTag = lowerText.includes(TESTDENTAL_TAG);
      const hasResetTag = lowerText.includes("#reset");
      const cleanedText = stripTestDentalTag(rawText);
      const text = cleanedText || rawText;
      const isoTime = new Date(ev.timestamp).toISOString();

      let organization_id = DEFAULT_ORG;
      let orgBusinessType = "";
      let orgTesterPsids = new Set<string>();
      if (channel === "messenger" && pageId) {
        const orgLookup = await supabase
          .from("org_settings")
          .select("organization_id,business_type,tester_psids")
          .eq("meta_page_id", pageId)
          .eq("messenger_enabled", true)
          .maybeSingle();
        if (!orgLookup.error && orgLookup.data?.organization_id) {
          organization_id = String(orgLookup.data.organization_id);
          orgBusinessType = String(orgLookup.data.business_type ?? "").trim();
          collectTesterPsids(orgTesterPsids, orgLookup.data?.tester_psids);
        }
      } else if (channel === "whatsapp" && phoneNumberId) {
        const orgLookup = await supabase
          .from("org_settings")
          .select("organization_id,business_type")
          .eq("whatsapp_phone_number_id", phoneNumberId)
          .eq("whatsapp_enabled", true)
          .maybeSingle();
        if (!orgLookup.error && orgLookup.data?.organization_id) {
          organization_id = String(orgLookup.data.organization_id);
          orgBusinessType = String(orgLookup.data.business_type ?? "").trim();
        }
      }
      orgIds.add(organization_id);
      if (!orgBusinessType) {
        const typeRes = await supabase
          .from("org_settings")
          .select("business_type")
          .eq("organization_id", organization_id)
          .maybeSingle();
        if (!typeRes.error) {
          orgBusinessType = String(typeRes.data?.business_type ?? "").trim();
        }
      }
      if (!orgTesterPsids.size) {
        const testerRes = await supabase
          .from("org_settings")
          .select("tester_psids")
          .eq("organization_id", organization_id)
          .maybeSingle();
        if (!testerRes.error) {
          collectTesterPsids(orgTesterPsids, testerRes.data?.tester_psids);
        }
      }
      const isTester = channel === "messenger" && orgTesterPsids.has(senderId);
      console.log("[meta-webhook] inbound", {
        organization_id,
        page_id: pageId,
        phone_number_id: phoneNumberId,
        sender_id: senderId,
        channel,
        provider_message_id: providerMid,
        has_testdental_tag: hasTestdentalTag,
        is_tester: isTester,
      });

      const { data: existingLead, error: selErr } = await supabase
        .from("leads")
        .select("id, state, full_name, channel")
        .eq("organization_id", organization_id)
        .eq("channel", channel)
        .eq("channel_user_id", senderId)
        .maybeSingle();
      if (selErr) throw selErr;

      const nextState = ensureConversationState(ensureState(existingLead?.state));
      const existingMode = safeString(nextState.mode);
      const resetTriggered = organization_id === "creatyv-product" && isTester && hasResetTag;
      if (resetTriggered) {
        nextState.mode = "creatyv_product";
        nextState.phase = "new";
        nextState.mode_locked = false;
        nextState.collected = {};
        nextState.slots = {};
        nextState.last_bot_question = null;
        nextState.last_bot_question_key = null;
        nextState.last_bot_text = null;
        nextState.intent = null;
        nextState.last_seen_inbound_provider_mid = null;
        nextState.last_seen_inbound_mid = null;
      }
      const resolvedMode = resolveMode({
        organizationId: organization_id,
        leadState: nextState,
        orgBusinessType,
        hasTestDentalTag: isTester && hasTestdentalTag,
      });
      const shouldActivateDental =
        organization_id === "creatyv-product" &&
        isTester &&
        hasTestdentalTag &&
        !existingMode &&
        !resetTriggered;
      if (shouldActivateDental) {
        nextState.mode = "dental_clinic";
        nextState.phase = "new";
        nextState.mode_locked = true;
      } else if (organization_id === "creatyv-product") {
        nextState.mode = resolvedMode || "creatyv_product";
        if (nextState.mode === "creatyv_product") {
          nextState.mode_locked = false;
        }
      } else {
        nextState.mode = resolvedMode;
      }
      const existingFullName = String(existingLead?.full_name ?? "").trim();
      const stateName = String(nextState?.name ?? "").trim();
      const existingRealName = existingFullName && !existingFullName.startsWith("Usuario ") ? existingFullName : "";
      const stateRealName = stateName && !stateName.startsWith("Usuario ") ? stateName : "";
      const hasRealName = Boolean(existingRealName || stateRealName);
      let resolvedName: string | null = existingRealName || stateRealName || null;
      let resolvedFirstName: string | null = null;
      let resolvedLastName: string | null = null;
      let resolvedProfilePic: string | null = String(nextState?.profile_pic ?? "").trim() || null;
      let metaProfileLookupAttempted = false;
      let metaProfileLookupSucceeded = false;

      if (!hasRealName && (channel === "messenger" || channel === "instagram")) {
        metaProfileLookupAttempted = true;
        try {
          const token = await resolvePageToken(supabase, organization_id);
          if (token) {
            const profile = await fetchMetaProfileDetails({ pageAccessToken: token, psid: senderId });
            if (profile?.firstName) resolvedFirstName = profile.firstName;
            if (profile?.lastName) resolvedLastName = profile.lastName;
            if (profile?.fullName) resolvedName = profile.fullName;
            if (profile?.profilePic) resolvedProfilePic = profile.profilePic;
            metaProfileLookupSucceeded = Boolean(profile?.fullName || profile?.firstName || profile?.lastName);
          }
        } catch (err) {
          console.warn("[meta-webhook] graph_api_profile_fetch_failed", {
            organization_id,
            psid: senderId,
            error: String((err as any)?.message ?? err),
          });
          metaProfileLookupSucceeded = false;
        }
      }
      if (!resolvedName && channel === "whatsapp") {
        resolvedName = safeString(ev.sender_name) || null;
      }
      const graphGotName = Boolean(resolvedName && !resolvedName.startsWith("Usuario "));
      nextState.name = resolvedName;
      nextState.full_name = resolvedName;
      nextState.collected_name = hasRealName || graphGotName;
      nextState.meta_profile_lookup_attempted = metaProfileLookupAttempted;
      nextState.meta_profile_lookup_succeeded = metaProfileLookupSucceeded;
      if (graphGotName) {
        nextState.asked = { ...(nextState.asked ?? {}), full_name: true };
        nextState.collected = { ...(nextState.collected ?? {}), full_name: resolvedName };
      }
      if (resolvedProfilePic) nextState.profile_pic = resolvedProfilePic;

      const upsertPayload: Record<string, unknown> = {
        organization_id,
        channel,
        last_channel: channel,
        channel_user_id: senderId,
        full_name: resolvedName,
        first_name: resolvedFirstName,
        last_name: resolvedLastName,
        avatar_url: resolvedProfilePic,
        last_message_preview: text.slice(0, 140),
        last_message_at: isoTime,
        state: nextState,
      };
      if (resetTriggered) {
        upsertPayload.last_seen_inbound_message_id = null;
      }
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
          role: "user",
          actor: "user",
          content: text,
          created_at: new Date().toISOString(),
          provider_message_id: providerMid,
          inbound_message_id: providerMid,
          channel_user_id: senderId,
        })
        .select("id")
        .maybeSingle();
      if (msgInsert.error) {
        console.warn("[meta-webhook] message_insert_failed", {
          organization_id,
          lead_id: lead.id,
          error: String(msgInsert.error.message ?? ""),
        });
      }
      const insertedMessageId = (msgInsert.data as any)?.id ?? null;

      const canEnqueue = Boolean(text && text.trim()) && Boolean(providerMid);
      if (canEnqueue) {
        const outboxPayload = {
          organization_id,
          lead_id: lead.id,
          channel,
          channel_user_id: senderId,
          status: "queued",
          scheduled_for: new Date().toISOString(),
          inbound_provider_message_id: providerMid,
          payload: {
            text,
            channel,
            channel_user_id: senderId,
            organization_id,
            inbound_provider_message_id: providerMid,
            trace_id: traceId,
          },
        };
        const outboxInsert = await supabase
          .from("reply_outbox")
          .insert(outboxPayload, {
            onConflict: "organization_id,inbound_provider_message_id",
            ignoreDuplicates: true,
          })
          .select("id")
          .maybeSingle();
        let enqueueStatus: "enqueued" | "duplicate_skip" = "duplicate_skip";
        let enqueuedOutboxId: string | null = null;
        if (outboxInsert.error) {
          const em = String(outboxInsert.error.message ?? "").toLowerCase();
          if (!em.includes("duplicate")) throw outboxInsert.error;
        } else if (outboxInsert.data?.id) {
          created_jobs += 1;
          enqueueStatus = "enqueued";
          enqueuedOutboxId = String(outboxInsert.data.id);
        }
        console.log("[meta-webhook] enqueue", {
          organization_id,
          sender_id: senderId,
          provider_message_id: providerMid,
          outbox_id: enqueuedOutboxId,
          result: enqueueStatus,
        });
      } else {
        console.log("[meta-webhook] enqueue_skip", {
          organization_id,
          sender_id: senderId,
          provider_message_id: providerMid,
          reason: !providerMid ? "missing_mid" : "missing_text",
        });
      }

      if (shouldScheduleFollowup(text)) {
        const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const followupRes = await supabase
          .from("followup_outbox")
          .upsert(
            {
              organization_id,
              lead_id: lead.id,
              channel_user_id: senderId,
              provider: channel === "whatsapp" ? "whatsapp" : "meta",
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
