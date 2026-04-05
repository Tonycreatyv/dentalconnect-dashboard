import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    const {
      organization_id,
      to_phone,
      template_name,
      template_language,
      components,
    } = await req.json();

    const organizationId = String(organization_id ?? "").trim();
    const toPhone = String(to_phone ?? "").trim();
    const templateName = String(template_name ?? "").trim();

    if (!organizationId || !toPhone || !templateName) {
      return new Response(JSON.stringify({ error: "organization_id, to_phone and template_name are required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("org_settings")
      .select("whatsapp_phone_number_id, whatsapp_access_token")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (settingsError) {
      return new Response(JSON.stringify({ error: settingsError.message }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? "").trim();
    const accessToken = String(settings?.whatsapp_access_token ?? "").trim();
    if (!phoneNumberId || !accessToken) {
      return new Response(JSON.stringify({ error: "WhatsApp not configured" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: String(template_language ?? "es").trim() || "es" },
          components: Array.isArray(components) ? components : [],
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), {
      status: res.ok ? 200 : 400,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
