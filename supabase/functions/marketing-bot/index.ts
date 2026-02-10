import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);

  const body = await req.json();

  const { name, contact, question, intent } = body;

  await supabase.from("marketing_leads").insert({
    source: "creatyv_faq_bot",
    name: name ?? null,
    contact: contact ?? null,
    question,
    intent,
  });

  return json({
    ok: true,
    reply:
      "Gracias 😊 Un asesor revisará tu consulta. Si deseas, puedes probar DentalConnect gratis por 7 días.",
  });
});
