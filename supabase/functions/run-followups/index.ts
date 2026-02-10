import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = { org: string; limit?: number; tz?: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    // 1) Secret propio (anti-abuso)
    const secret = req.headers.get("x-followup-secret") ?? "";
    const expected = Deno.env.get("FOLLOWUP_RUN_SECRET") ?? "";
    if (!expected || secret !== expected) return json({ error: "unauthorized" }, 401);

    // 2) Parse body
    const body = (await req.json().catch(() => ({}))) as Partial<Body>;
    const org = (body.org ?? "").trim();
    const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 50);
    const tz = (body.tz ?? "America/Tegucigalpa").trim();

    if (!org) return json({ error: "missing_org" }, 400);

    // 3) Supabase client (Service Role)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "missing_supabase_secrets" }, 500);
    }

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // 4) Reclamar leads listos (usa tu RPC existente)
    //    IMPORTANTE: esta llamada DEBE devolver rows; si devuelve [] no hay trabajo.
    const { data: leads, error: claimErr } = await sb.rpc("claim_followups", {
      p_org: org,
      p_limit: limit,
      p_tz: tz,
    });

    if (claimErr) return json({ error: "claim_failed", details: claimErr.message }, 500);
    if (!leads || leads.length === 0) return json({ ok: true, claimed: 0 });

    // 5) OpenAI
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!openaiKey) return json({ error: "missing_openai_key" }, 500);

    const results: any[] = [];

    for (const lead of leads) {
      // Para cada lead: crear outbox + calcular step/next_due en DB
      const { data: outboxRows, error: enqErr } = await sb.rpc("enqueue_followup", {
        p_lead_id: lead.id,
        p_tz: tz,
      });

      if (enqErr || !outboxRows?.length) {
        // Si falla enqueue, despega el lead para no dejarlo colgado
        await sb.from("leads").update({ conversation_state: "waiting_user" }).eq("id", lead.id);
        results.push({ lead_id: lead.id, ok: false, stage: "enqueue", error: enqErr?.message ?? "enqueue_failed" });
        continue;
      }

      const outbox = outboxRows[0];
      const outboxId = String(outbox.outbox_id ?? outbox.id ?? "").trim();

      // Prompt (simple y robusto)
      const policy = String(outbox.policy ?? lead.follow_up_policy ?? "cold");
      const step = Number(outbox.step_to_send ?? outbox.step ?? 1);
      const channel = String(outbox.channel ?? lead.channel ?? "web");
      const last_intent = String(lead.last_intent ?? "general");

      const payload = {
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "Eres un asistente de seguimiento comercial B2C. Escribe UN solo mensaje corto en español (2–4 líneas, max 280 caracteres), sin emojis, sin firmas, sin placeholders. Objetivo: provocar respuesta o siguiente paso. Varía el texto según policy y step. policy=cold: 0 preguntas. policy=warm/hot: máximo 1 pregunta. No repitas 'solo quería hacer seguimiento'.",
          },
          {
            role: "user",
            content: `policy=${policy}, step=${step}. Canal=${channel}. Intención previa=${last_intent}. Escribe el mensaje.`,
          },
        ],
      };

      let messageText = "";

      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const j = await r.json();
        messageText = j?.choices?.[0]?.message?.content?.trim?.() ?? "";

        if (!r.ok || !messageText) {
          const errMsg = j?.error?.message ?? `openai_failed_status_${r.status}`;
          // Marcar failed
          await sb.rpc("mark_followup_failed", { p_outbox_id: outboxId, p_error: String(errMsg) });
          results.push({ outbox_id: outboxId, lead_id: lead.id, ok: false, stage: "openai", error: errMsg });
          continue;
        }
      } catch (e) {
        await sb.rpc("mark_followup_failed", { p_outbox_id: outboxId, p_error: String(e?.message ?? e) });
        results.push({ outbox_id: outboxId, lead_id: lead.id, ok: false, stage: "openai", error: String(e?.message ?? e) });
        continue;
      }

      // 6) Marcar sent (usa la versión de 2 args si la tienes; es la más estable)
      //    Si tu mark_followup_sent(2 args) ya calcula next_due_at dentro, mejor.
      const { error: sentErr } = await sb.rpc("mark_followup_sent", {
        p_outbox_id: outboxId,
        p_message: messageText,
      });

      if (sentErr) {
        await sb.rpc("mark_followup_failed", { p_outbox_id: outboxId, p_error: sentErr.message });
        results.push({ outbox_id: outboxId, lead_id: lead.id, ok: false, stage: "mark_sent", error: sentErr.message });
        continue;
      }

      results.push({ outbox_id: outboxId, lead_id: lead.id, ok: true });
    }

    return json({ ok: true, claimed: leads.length, results });
  } catch (e) {
    return json({ error: "fatal", details: String(e?.message ?? e) }, 500);
  }
});
