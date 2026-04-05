import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Content-Type": "application/json",
};

function safeStr(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function mapComponentsToColumns(components: any[] | undefined) {
  const list = Array.isArray(components) ? components : [];
  const header = list.find((item) => safeStr(item?.type).toUpperCase() === "HEADER");
  const body = list.find((item) => safeStr(item?.type).toUpperCase() === "BODY");
  const footer = list.find((item) => safeStr(item?.type).toUpperCase() === "FOOTER");
  const buttons = list.find((item) => safeStr(item?.type).toUpperCase() === "BUTTONS");

  return {
    header_text: safeStr(header?.text) || null,
    body_text: safeStr(body?.text) || "",
    footer_text: safeStr(footer?.text) || null,
    buttons: buttons?.buttons ?? null,
  };
}

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

    const { action, organization_id, template_data, name } = await req.json();
    const organizationId = safeStr(organization_id).trim();
    const requestedAction = safeStr(action).trim().toLowerCase();

    if (!organizationId || !requestedAction) {
      return new Response(JSON.stringify({ error: "organization_id and action are required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("org_settings")
      .select("whatsapp_business_account_id, whatsapp_access_token")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (settingsError) {
      return new Response(JSON.stringify({ error: settingsError.message }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const wabaId = safeStr(settings?.whatsapp_business_account_id).trim();
    const accessToken = safeStr(settings?.whatsapp_access_token).trim();
    if (!wabaId || !accessToken) {
      return new Response(JSON.stringify({ error: "WhatsApp Business is not configured" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (requestedAction === "list") {
      const graphRes = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/message_templates?limit=100`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const graphData = await graphRes.json().catch(() => ({}));
      const templates = Array.isArray(graphData?.data) ? graphData.data : [];

      for (const item of templates) {
        const mapped = mapComponentsToColumns(item.components);
        await supabase.from("message_templates").upsert({
          organization_id: organizationId,
          name: safeStr(item?.name),
          language: safeStr(item?.language ?? "es"),
          category: safeStr(item?.category ?? "UTILITY"),
          status: safeStr(item?.status ?? "PENDING"),
          meta_template_id: safeStr(item?.id) || safeStr(item?.name),
          updated_at: new Date().toISOString(),
          ...mapped,
        }, { onConflict: "organization_id,name" });
      }

      const localRes = await supabase
        .from("message_templates")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      return new Response(JSON.stringify({
        ok: graphRes.ok,
        templates: localRes.data ?? [],
        graph: graphData,
      }), {
        status: graphRes.ok ? 200 : 400,
        headers: corsHeaders,
      });
    }

    if (requestedAction === "create") {
      const payload = template_data ?? {};
      const components = Array.isArray(payload?.components) ? payload.components : [];
      const bodyText = safeStr(
        components.find((item: any) => safeStr(item?.type).toUpperCase() === "BODY")?.text
      ).trim();

      if (!safeStr(payload?.name).trim() || !bodyText) {
        return new Response(JSON.stringify({ error: "Template name and BODY component are required" }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const graphRes = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/message_templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: safeStr(payload?.name).trim(),
          language: safeStr(payload?.language ?? "es").trim() || "es",
          category: safeStr(payload?.category ?? "UTILITY").trim() || "UTILITY",
          components,
        }),
      });

      const graphData = await graphRes.json().catch(() => ({}));
      const mapped = mapComponentsToColumns(components);
      const upsertRes = await supabase.from("message_templates").upsert({
        organization_id: organizationId,
        name: safeStr(payload?.name).trim(),
        language: safeStr(payload?.language ?? "es").trim() || "es",
        category: safeStr(payload?.category ?? "UTILITY").trim() || "UTILITY",
        status: safeStr(graphData?.status ?? "PENDING"),
        meta_template_id: safeStr(graphData?.id) || safeStr(graphData?.message_template_id) || null,
        updated_at: new Date().toISOString(),
        ...mapped,
      }, { onConflict: "organization_id,name" });

      return new Response(JSON.stringify({
        ok: graphRes.ok && !upsertRes.error,
        data: graphData,
        error: upsertRes.error?.message ?? null,
      }), {
        status: graphRes.ok && !upsertRes.error ? 200 : 400,
        headers: corsHeaders,
      });
    }

    if (requestedAction === "delete") {
      const templateName = safeStr(name || template_data?.name).trim();
      if (!templateName) {
        return new Response(JSON.stringify({ error: "Template name is required for delete" }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const graphUrl = new URL(`https://graph.facebook.com/v19.0/${wabaId}/message_templates`);
      graphUrl.searchParams.set("name", templateName);

      const graphRes = await fetch(graphUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const graphData = await graphRes.json().catch(() => ({}));

      await supabase
        .from("message_templates")
        .delete()
        .eq("organization_id", organizationId)
        .eq("name", templateName);

      return new Response(JSON.stringify({ ok: graphRes.ok, data: graphData }), {
        status: graphRes.ok ? 200 : 400,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "Unsupported action" }), {
      status: 400,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: safeStr((err as Error)?.message ?? err, "unknown") }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
