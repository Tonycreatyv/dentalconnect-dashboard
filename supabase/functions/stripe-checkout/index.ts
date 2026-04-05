import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

type Plan = "starter" | "growth" | "pro";

const PRICE_ENV_BY_PLAN: Record<Plan, string> = {
  starter: "STRIPE_PRICE_STARTER",
  growth: "STRIPE_PRICE_GROWTH",
  pro: "STRIPE_PRICE_PRO",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE = env("SUPABASE_SERVICE_ROLE_KEY");
    const STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY");
    const PUBLIC_APP_URL = env("PUBLIC_APP_URL");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const organizationId = String(body?.organization_id ?? "").trim();
    const planRaw = String(body?.plan ?? "pro").toLowerCase() as Plan;
    const plan: Plan = planRaw === "starter" || planRaw === "growth" || planRaw === "pro" ? planRaw : "pro";
    const priceId = env(PRICE_ENV_BY_PLAN[plan]);

    if (!organizationId) return json(400, { ok: false, error: "missing_organization_id" });

    const org = await supabase
      .from("org_settings")
      .select("name, stripe_customer_id")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const customerId = String(org.data?.stripe_customer_id ?? "");

    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", `${PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${PUBLIC_APP_URL}/billing/cancel`);
    params.set("client_reference_id", organizationId);
    params.set("metadata[organization_id]", organizationId);
    params.set("metadata[plan]", plan);
    params.set("subscription_data[trial_period_days]", "14");
    params.set("subscription_data[metadata][organization_id]", organizationId);
    params.set("subscription_data[metadata][plan]", plan);
    if (customerId) params.set("customer", customerId);
    // customer auto-created in subscription mode

    const checkoutRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const checkout = await checkoutRes.json();
    if (!checkoutRes.ok) {
      return json(500, { ok: false, error: checkout?.error?.message ?? "stripe_checkout_failed" });
    }

    if (!customerId && checkout?.customer) {
      await supabase
        .from("org_settings")
        .update({ stripe_customer_id: String(checkout.customer), updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId);
    }

    return json(200, { ok: true, url: String(checkout.url ?? "") });
  } catch (error: any) {
    return json(500, { ok: false, error: String(error?.message ?? error) });
  }
});
