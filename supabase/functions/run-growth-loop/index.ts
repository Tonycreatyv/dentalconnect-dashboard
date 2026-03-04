import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  organization_id?: string;
  lookback_days?: number;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-run-growth-loop-secret",
    },
  });
}

function safeStr(v: unknown, d = "") {
  if (typeof v === "string") return v;
  if (v == null) return d;
  return String(v);
}

function appointmentStart(row: any) {
  return safeStr(row?.start_at, "") || safeStr(row?.starts_at, "");
}

function countMentions(texts: string[]) {
  const buckets: Record<string, string[]> = {
    whitening: ["blanqueamiento", "whitening"],
    limpieza: ["limpieza", "profilaxis"],
    brackets: ["brackets", "ortodoncia", "alineadores"],
    implantes: ["implante", "implantes"],
  };
  const out: Record<string, number> = {};
  for (const key of Object.keys(buckets)) out[key] = 0;
  for (const raw of texts) {
    const t = raw.toLowerCase();
    for (const [bucket, words] of Object.entries(buckets)) {
      if (words.some((w) => t.includes(w))) out[bucket] += 1;
    }
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const expected = safeStr(Deno.env.get("RUN_GROWTH_LOOP_SECRET"), "");
    const provided = safeStr(req.headers.get("x-run-growth-loop-secret"), "");
    if (expected && provided !== expected) return json(401, { ok: false, error: "unauthorized" });

    const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL"), "");
    const SERVICE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const orgId = safeStr(body.organization_id, "").trim();
    if (!orgId) return json(400, { ok: false, error: "missing_organization_id" });
    const lookbackDays = Math.max(1, Math.min(Number(body.lookback_days ?? 14) || 14, 90));

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    let reviewActions = 0;
    let recallActions = 0;
    let insightsCreated = 0;

    const completedSince = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const completed = await sb
      .from("appointments")
      .select("id, organization_id, lead_id, start_at, starts_at, status, reason, title, patient_name")
      .eq("organization_id", orgId)
      .eq("status", "completed")
      .gte("updated_at", completedSince)
      .order("updated_at", { ascending: false })
      .limit(100);

    for (const appt of completed.data ?? []) {
      const apptId = safeStr((appt as any).id, "");
      const leadId = safeStr((appt as any).lead_id, "");
      if (!apptId || !leadId) continue;

      const requestedAlready = await sb
        .from("growth_events")
        .select("id")
        .eq("organization_id", orgId)
        .eq("event_type", "review_requested")
        .eq("appointment_id", apptId)
        .limit(1)
        .maybeSingle();
      if (!requestedAlready.error && requestedAlready.data?.id) continue;

      await sb.from("growth_events").insert({
        organization_id: orgId,
        event_type: "appointment_completed",
        lead_id: leadId,
        appointment_id: apptId,
        metadata: {
          service: safeStr((appt as any).reason ?? (appt as any).title, "servicio"),
          appointment_time: appointmentStart(appt),
        },
      });

      const leadRes = await sb
        .from("leads")
        .select("id, channel, channel_user_id, full_name")
        .eq("organization_id", orgId)
        .eq("id", leadId)
        .maybeSingle();
      if (leadRes.error || !leadRes.data) continue;

      const reviewLinkRes = await sb
        .from("org_settings")
        .select("google_review_url")
        .eq("organization_id", orgId)
        .limit(1)
        .maybeSingle();
      const reviewLink = safeStr((reviewLinkRes.data as any)?.google_review_url, "");

      const reviewText = reviewLink
        ? `Gracias por visitarnos hoy.\nSi tu experiencia fue buena,\nnos ayudaría mucho una reseña.\n${reviewLink}`
        : "Gracias por visitarnos hoy.\nSi tu experiencia fue buena,\nnos ayudaría mucho una reseña.";

      await sb.from("actions").insert({
        organization_id: orgId,
        type: "request_review",
        title: "Solicitar reseña",
        description: `Paciente atendido recientemente. Solicita reseña para crecer orgánicamente.`,
        priority: 92,
        status: "open",
        payload: {
          lead_id: leadId,
          appointment_id: apptId,
          channel: safeStr((leadRes.data as any).channel, "messenger"),
          channel_user_id: safeStr((leadRes.data as any).channel_user_id, ""),
          text: reviewText,
          review_link: reviewLink || null,
        },
      });
      reviewActions += 1;

      await sb.from("growth_events").insert({
        organization_id: orgId,
        event_type: "review_requested",
        lead_id: leadId,
        appointment_id: apptId,
        metadata: {
          via: "action_engine",
          review_link: reviewLink || null,
        },
      });
    }

    const rules = await sb
      .from("recall_rules")
      .select("id, service_type, interval_days, template, is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .limit(20);

    const activeRules = rules.data ?? [];
    if (activeRules.length > 0) {
      const allCompleted = await sb
        .from("appointments")
        .select("id, lead_id, status, start_at, starts_at, reason, title")
        .eq("organization_id", orgId)
        .eq("status", "completed")
        .order("start_at", { ascending: false })
        .limit(1000);

      const latestByLead = new Map<string, any>();
      for (const appt of allCompleted.data ?? []) {
        const leadId = safeStr((appt as any).lead_id, "");
        if (!leadId || latestByLead.has(leadId)) continue;
        latestByLead.set(leadId, appt);
      }

      for (const [leadId, appt] of latestByLead.entries()) {
        const startIso = appointmentStart(appt);
        if (!startIso) continue;
        const ageDays = Math.floor((Date.now() - new Date(startIso).getTime()) / (24 * 60 * 60 * 1000));

        const matching = activeRules.find((r: any) => ageDays >= Number(r.interval_days ?? 0));
        if (!matching) continue;

        const recentRecall = await sb
          .from("growth_events")
          .select("id")
          .eq("organization_id", orgId)
          .eq("event_type", "recall_sent")
          .eq("lead_id", leadId)
          .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1)
          .maybeSingle();
        if (!recentRecall.error && recentRecall.data?.id) continue;

        await sb.from("actions").insert({
          organization_id: orgId,
          type: "send_recall_message",
          title: "Enviar recall",
          description: `Paciente sin visita reciente (>${matching.interval_days} días).`,
          priority: 84,
          status: "open",
          payload: {
            lead_id: leadId,
            text: safeStr((matching as any).template, "Hola 👋 Hace un tiempo fue tu última visita. ¿Te gustaría agendar tu próxima cita?"),
            recall_rule_id: safeStr((matching as any).id, ""),
          },
        });
        recallActions += 1;
      }
    }

    const msgsSince = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const userMessages = await sb
      .from("messages")
      .select("content")
      .eq("organization_id", orgId)
      .eq("role", "user")
      .gte("created_at", msgsSince)
      .limit(2000);

    const texts = (userMessages.data ?? [])
      .map((m: any) => safeStr(m?.content, "").trim())
      .filter(Boolean);
    if (texts.length > 0) {
      const counts = countMentions(texts);
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      await sb.from("marketing_insights").insert({
        organization_id: orgId,
        period_start: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        period_end: new Date().toISOString().slice(0, 10),
        metric_key: "service_interest",
        metric_value_json: {
          counts,
          top_topic: top?.[0] ?? null,
          top_count: top?.[1] ?? 0,
          suggestion:
            top && top[0] === "whitening"
              ? "beneficios del blanqueamiento dental"
              : top && top[0] === "limpieza"
              ? "promoción de limpieza dental"
              : "consejos de salud dental y prevención",
        },
      });
      insightsCreated += 1;

      if ((top?.[1] ?? 0) >= 10) {
        await sb.from("actions").insert({
          organization_id: orgId,
          type: "marketing_opportunity",
          title: "Oportunidad de contenido",
          description: `${top?.[1]} mensajes recientes muestran interés en ${top?.[0]}.`,
          priority: 72,
          status: "open",
          payload: {
            suggested_topic:
              top && top[0] === "whitening"
                ? "beneficios del blanqueamiento dental"
                : top && top[0] === "limpieza"
                ? "promoción de limpieza dental"
                : "post educativo de servicios",
            interest_count: top?.[1] ?? 0,
          },
        });
      }
    }

    return json(200, {
      ok: true,
      organization_id: orgId,
      review_actions: reviewActions,
      recall_actions: recallActions,
      insights_created: insightsCreated,
    });
  } catch (error) {
    return json(500, { ok: false, error: safeStr((error as Error)?.message, String(error)) });
  }
});
