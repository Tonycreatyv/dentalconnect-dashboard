// supabase/functions/trial-signup/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Payload = {
  clinic_name: string;
  contact_name: string;
  clinic_phone: string;
  contact_email: string;
  meta_email?: string;
  page_url?: string;
  notes?: string;
  locale?: "es" | "en";
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload: Payload | null = null;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const clinic_name = payload?.clinic_name?.trim();
  const contact_name = payload?.contact_name?.trim();
  const clinic_phone = payload?.clinic_phone?.trim();
  const contact_email = payload?.contact_email?.trim();
  const meta_email = payload?.meta_email?.trim() || null;
  const page_url = payload?.page_url?.trim() || null;
  const notes = payload?.notes?.trim() || null;
  const locale = payload?.locale === "en" ? "en" : "es";

  if (!clinic_name || !contact_name || !clinic_phone || !contact_email) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("trial_requests")
    .insert({
      clinic_name,
      contact_name,
      clinic_phone,
      contact_email,
      meta_email,
      page_url,
      notes,
      locale,
      source: "landing",
      org_type: "dental",
      status: "new",
    })
    .select("id, created_at")
    .single();

  if (error) return json({ ok: false, error: error.message }, 500);

  // --- EMAIL (OPCIONAL) ---
  // Recomendado: MailerSend (o Resend). Si no lo configuras, igual queda guardado.
  // Env vars:
  //   MAILERSEND_API_KEY
  //   MAIL_FROM (ej: "Creatyv <contact@creatyv.io>")
  //   TRIAL_CONNECT_URL_BASE (ej: "https://creatyv.io/trial-connect")
  //
  // El link del correo debe ir a tu flujo de Meta OAuth (conectar Messenger).
  // En demo: solo arma un link con el ID para que tú lo uses.

  const connectBase = Deno.env.get("TRIAL_CONNECT_URL_BASE") || "https://creatyv.io/trial";
  const connectUrl = `${connectBase}?req=${data.id}`;

  const MAILERSEND_API_KEY = Deno.env.get("MAILERSEND_API_KEY");
  const MAIL_FROM = Deno.env.get("MAIL_FROM");

  if (MAILERSEND_API_KEY && MAIL_FROM) {
    const subject = locale === "en"
      ? "Your DentalConnect free trial request"
      : "Tu solicitud de prueba gratis DentalConnect";

    const html = locale === "en"
      ? `
        <div style="font-family:system-ui,sans-serif;line-height:1.5">
          <h2>We received your request ✅</h2>
          <p>Next step: connect your Facebook Page (Messenger).</p>
          <p><a href="${connectUrl}">Connect Messenger</a></p>
          <p><b>Important:</b> To connect Messenger, sign in with the Facebook account that manages your Page.</p>
        </div>
      `
      : `
        <div style="font-family:system-ui,sans-serif;line-height:1.5">
          <h2>Recibimos tu solicitud ✅</h2>
          <p>Siguiente paso: conectar tu Página de Facebook (Messenger).</p>
          <p><a href="${connectUrl}">Conectar Messenger</a></p>
          <p><b>Importante:</b> para conectar Messenger, inicia sesión con la cuenta de Facebook que administra la Página.</p>
        </div>
      `;

    try {
      await fetch("https://api.mailersend.com/v1/email", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MAILERSEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: { email: MAIL_FROM.includes("<") ? MAIL_FROM.split("<")[1].replace(">", "").trim() : MAIL_FROM },
          to: [{ email: contact_email }],
          subject,
          html,
        }),
      });
    } catch {
      // si falla email, no rompemos el flow
    }
  }

  return json({ ok: true, request_id: data.id, connect_url: connectUrl });
});
