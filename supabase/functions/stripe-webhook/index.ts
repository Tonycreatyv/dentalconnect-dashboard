import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

async function verifyStripeSignature(payload: string, signature: string, secret: string) {
  const parts = signature.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!t || !v1) return false;

  const signedPayload = `${t}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === v1;
}

type StripeObject = Record<string, any>;
type StripeEvent = { type?: string; data?: { object?: StripeObject } };

function stripeStatusToDb(status: string): "trialing" | "active" | "past_due" | "canceled" {
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  return "canceled";
}

function unixToIso(input: unknown): string | null {
  const n = Number(input ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

async function upsertSubscription(
  supabase: ReturnType<typeof createClient>,
  payload: {
    organization_id: string;
    plan: "starter" | "growth" | "pro";
    status: "trialing" | "active" | "past_due" | "canceled";
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    trial_started_at?: string | null;
    trial_ends_at?: string | null;
    current_period_end?: string | null;
  }
) {
  const now = new Date().toISOString();

  await supabase.from("subscriptions").upsert(
    {
      organization_id: payload.organization_id,
      plan: payload.plan,
      status: payload.status,
      stripe_customer_id: payload.stripe_customer_id ?? null,
      stripe_subscription_id: payload.stripe_subscription_id ?? null,
      trial_started_at: payload.trial_started_at ?? null,
      trial_ends_at: payload.trial_ends_at ?? null,
      current_period_end: payload.current_period_end ?? null,
      updated_at: now,
    },
    { onConflict: "organization_id" }
  );

  await supabase
    .from("org_settings")
    .update({
      plan: payload.plan,
      billing_status: payload.status,
      stripe_customer_id: payload.stripe_customer_id ?? null,
      stripe_subscription_id: payload.stripe_subscription_id ?? null,
      is_trial_active: payload.status === "trialing",
      trial_started_at: payload.status === "trialing" ? payload.trial_started_at ?? now : null,
      trial_ends_at: payload.status === "trialing" ? payload.trial_ends_at : null,
      messenger_enabled: payload.status === "active" || payload.status === "trialing",
      updated_at: now,
    })
    .eq("organization_id", payload.organization_id);
}

async function resolveOrganizationId(
  supabase: ReturnType<typeof createClient>,
  object: StripeObject
): Promise<string> {
  const direct = String(
    object?.metadata?.organization_id ?? object?.client_reference_id ?? object?.subscription_details?.metadata?.organization_id ?? ""
  );
  if (direct) return direct;

  const subscriptionId = String(object?.subscription ?? object?.id ?? "");
  if (subscriptionId) {
    const subById = await supabase
      .from("subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (!subById.error && subById.data?.organization_id) return String(subById.data.organization_id);
  }

  const customerId = String(object?.customer ?? "");
  if (customerId) {
    const subByCustomer = await supabase
      .from("subscriptions")
      .select("organization_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (!subByCustomer.error && subByCustomer.data?.organization_id) return String(subByCustomer.data.organization_id);

    const orgByCustomer = await supabase
      .from("org_settings")
      .select("organization_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (!orgByCustomer.error && orgByCustomer.data?.organization_id) return String(orgByCustomer.data.organization_id);
  }

  return "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE = env("SUPABASE_SERVICE_ROLE_KEY");
    const STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET");
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const signature = req.headers.get("stripe-signature") ?? "";
    const raw = await req.text();
    const verified = await verifyStripeSignature(raw, signature, STRIPE_WEBHOOK_SECRET);
    if (!verified) return json(400, { ok: false, error: "invalid_signature" });

    const event = JSON.parse(raw) as StripeEvent;
    const type = String(event?.type ?? "");
    const object = (event?.data?.object ?? {}) as StripeObject;
    const organizationId = await resolveOrganizationId(supabase, object);

    if (!organizationId) return json(200, { ok: true, ignored: true });

    if (type === "checkout.session.completed") {
      const plan = String(object?.metadata?.plan ?? "pro").toLowerCase();
      const safePlan = plan === "starter" || plan === "growth" || plan === "pro" ? plan : "pro";
      await upsertSubscription(supabase, {
        organization_id: organizationId,
        plan: safePlan,
        status: "trialing",
        stripe_customer_id: object?.customer ? String(object.customer) : null,
        stripe_subscription_id: object?.subscription ? String(object.subscription) : null,
        trial_started_at: new Date().toISOString(),
      });
    }

    if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const status = stripeStatusToDb(String(object?.status ?? "canceled"));
      const subRow = await supabase
        .from("subscriptions")
        .select("plan")
        .eq("organization_id", organizationId)
        .maybeSingle();
      const plan = String(object?.metadata?.plan ?? subRow.data?.plan ?? "pro").toLowerCase();
      const safePlan = plan === "starter" || plan === "growth" || plan === "pro" ? plan : "pro";

      await upsertSubscription(supabase, {
        organization_id: organizationId,
        plan: safePlan,
        status,
        stripe_customer_id: object?.customer ? String(object.customer) : null,
        stripe_subscription_id: object?.id ? String(object.id) : null,
        trial_ends_at: unixToIso(object?.trial_end),
        current_period_end: unixToIso(object?.current_period_end),
      });
    }

    if (type === "invoice.paid" || type === "invoice.payment_failed") {
      const status = type === "invoice.paid" ? "active" : "past_due";
      const subRow = await supabase
        .from("subscriptions")
        .select("plan, stripe_subscription_id, trial_ends_at")
        .eq("organization_id", organizationId)
        .maybeSingle();
      const plan = String(subRow.data?.plan ?? "pro").toLowerCase();
      const safePlan = plan === "starter" || plan === "growth" || plan === "pro" ? plan : "pro";

      await upsertSubscription(supabase, {
        organization_id: organizationId,
        plan: safePlan,
        status,
        stripe_customer_id: object?.customer ? String(object.customer) : null,
        stripe_subscription_id: String(object?.subscription ?? subRow.data?.stripe_subscription_id ?? ""),
        trial_ends_at: subRow.data?.trial_ends_at ?? null,
        current_period_end: unixToIso(object?.period_end),
      });
    }

    return json(200, { ok: true });
  } catch (error: any) {
    return json(500, { ok: false, error: String(error?.message ?? error) });
  }
});
