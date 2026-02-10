// supabase/functions/meta-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-meta-verify-token",
    },
  });
}

type MetaWebhook = {
  object?: string;
  entry?: Array<{
    id?: string; // page id
    time?: number;
    messaging?: Array<{
      sender?: { id?: string }; // PSID
      recipient?: { id?: string }; // Page ID
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
      };
    }>;
  }>;
};

function projectRefFromUrl(supabaseUrl: string) {
  try {
    const u = new URL(supabaseUrl);
    return u.hostname.split(".")[0]; // <ref>
  } catch {
    return "";
  }
}

async function triggerRunRepliesNow({
  projectRef,
  runRepliesSecret,
  org,
}: {
  projectRef: string;
  runRepliesSecret: string;
  org: string;
}) {
  // ✅ DIRECTO (no gateway)
  const url = `https://${projectRef}.functions.supabase.co/run-replies`;

  console.log("[meta-webhook] trigger url:", url);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-run-replies-secret": runRepliesSecret,
    },
    body: JSON.stringify({ org, limit: 1 }),
  });

  const bodyText = await resp.text().catch(() => "");
  console.log("[meta-webhook] trigger run-replies status:", resp.status);
  console.log("[meta-webhook] trigger run-replies body:", bodyText.slice(0, 300));

  return { ok: resp.ok, status: resp.status, bodyText };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);

  // ✅ Meta verification (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return json({ ok: false, error: "verify_failed" }, 403);
  }

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload: MetaWebhook | null = null;
  try {
    payload = (await req.json()) as MetaWebhook;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") || "clinic-demo";
  const RUN_REPLIES_SECRET = Deno.env.get("RUN_REPLIES_SECRET") || "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "missing_supabase_env" }, 500);
  if (!RUN_REPLIES_SECRET) return json({ ok: false, error: "missing_RUN_REPLIES_SECRET" }, 500);

  const projectRef = projectRefFromUrl(SUPABASE_URL);
  if (!projectRef) return json({ ok: false, error: "cannot_parse_project_ref" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const entries = payload?.entry ?? [];
  let enqueued = 0;
  let triggered = 0;

  for (const entry of entries) {
    const pageId = entry?.id ?? null;
    const messaging = entry?.messaging ?? [];

    for (const m of messaging) {
      const psid = m?.sender?.id ?? null;
      const mid = m?.message?.mid ?? null;
      const text = (m?.message?.text ?? "").trim();
      const isEcho = m?.message?.is_echo === true;

      if (isEcho) continue;
      if (!psid || !mid) continue;
      if (!text) continue;

      // 1) upsert inbound message (idempotente por provider_message_id)
      const { data: msgRow, error: msgErr } = await supabase
        .from("messages")
        .upsert(
          {
            organization_id: DEFAULT_ORG,
            channel: "messenger",
            role: "user",
            content: text,
            actor: "user",
            provider_message_id: mid,
          },
          { onConflict: "provider_message_id" }
        )
        .select("id")
        .single();

      if (msgErr || !msgRow?.id) {
        console.log("[meta-webhook] messages upsert error:", msgErr?.message || "no_row");
        continue;
      }

      const inboundId = msgRow.id as string;

      // 2) upsert outbox (1 job por inbound_message_id)
      const providerSnippet = {
        page_id: pageId,
        psid,
        mid,
        ts: m?.timestamp ?? null,
      };

      const { error: outboxErr } = await supabase
        .from("reply_outbox")
        .upsert(
          {
            organization_id: DEFAULT_ORG,
            channel: "messenger",
            channel_user_id: psid,
            inbound_message_id: inboundId,
            status: "queued",
            message_text: null,
            provider_payload: providerSnippet,
          },
          { onConflict: "inbound_message_id" }
        );

      if (outboxErr) {
        console.log("[meta-webhook] outbox upsert error:", outboxErr.message);
        continue;
      }

      enqueued += 1;
      console.log("[meta-webhook] enqueued outbox", inboundId, "psid:", psid);

      // 3) trigger inmediato (para <10s)
      const t = await triggerRunRepliesNow({
        projectRef,
        runRepliesSecret: RUN_REPLIES_SECRET,
        org: DEFAULT_ORG,
      });
      if (t.ok) triggered += 1;
    }
  }

  return json({ ok: true, enqueued, triggered });
});
