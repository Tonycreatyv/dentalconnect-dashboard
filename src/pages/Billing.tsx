import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import PageHeader from "../components/PageHeader";

type Plan = "starter" | "growth" | "pro";
type BillingStatus = "trialing" | "active" | "past_due" | "canceled";

const DEFAULT_ORG = "clinic-demo";

const PLANS: Array<{ id: Plan; title: string; price: string; features: string[] }> = [
  {
    id: "starter",
    title: "Starter",
    price: "$49/mes",
    features: ["Inbox central", "Agenda inteligente", "Reportes básicos"],
  },
  {
    id: "growth",
    title: "Growth",
    price: "$99/mes",
    features: ["Automatizaciones IA", "Integraciones sociales", "Seguimiento avanzado"],
  },
  {
    id: "pro",
    title: "Pro",
    price: "$199/mes",
    features: ["Marketing IA Posting", "Workflows completos", "Prioridad de soporte"],
  },
];

export default function Billing() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [plan, setPlan] = useState<Plan>("growth");
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);

  const trialDaysLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }, [trialEndsAt]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const sub = await supabase
        .from("subscriptions")
        .select("plan, status, trial_ends_at")
        .eq("organization_id", ORG)
        .maybeSingle();

      if (!mounted) return;

      if (!sub.error && sub.data) {
        const planValue = String((sub.data as any).plan ?? "growth") as Plan;
        if (planValue === "starter" || planValue === "growth" || planValue === "pro") setPlan(planValue);
        if (planValue === "starter" || planValue === "growth" || planValue === "pro") setCurrentPlan(planValue);
        setStatus(String((sub.data as any).status ?? "") as BillingStatus);
        setTrialEndsAt(((sub.data as any).trial_ends_at as string | null) ?? null);
        return;
      }

      const org = await supabase
        .from("org_settings")
        .select("plan, billing_status, trial_ends_at")
        .eq("organization_id", ORG)
        .maybeSingle();

      if (!mounted || org.error || !org.data) return;
      const planValue = String((org.data as any).plan ?? "growth") as Plan;
      if (planValue === "starter" || planValue === "growth" || planValue === "pro") setPlan(planValue);
      if (planValue === "starter" || planValue === "growth" || planValue === "pro") setCurrentPlan(planValue);
      setStatus(String((org.data as any).billing_status ?? "") as BillingStatus);
      setTrialEndsAt(((org.data as any).trial_ends_at as string | null) ?? null);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [ORG]);

  async function startCheckout() {
    setError(null);
    setLoading(true);
    const res = await supabase.functions.invoke("stripe-checkout", {
      body: { organization_id: ORG, plan },
    });
    setLoading(false);

    if (res.error || !res.data?.ok || !res.data?.url) {
      setError("No se pudo iniciar el pago. Intenta nuevamente.");
      return;
    }

    window.location.href = String(res.data.url);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <PageHeader
        title="Billing"
        subtitle="Elegí tu plan y continuá al checkout con prueba gratis de 14 días."
        showBackOnMobile
        backTo="/overview"
      />

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/85">
        <div className="mb-1 text-xs uppercase tracking-[0.16em] text-white/60">Plan actual</div>
        <div className="text-base font-semibold text-white/95">{(currentPlan ?? "starter").toUpperCase()}</div>
        {status === "trialing" ? (
          <span>Prueba gratis 14 días activa{trialDaysLeft !== null ? `: te quedan ${trialDaysLeft} días.` : "."}</span>
        ) : status === "active" ? (
          <span>Tu suscripción está activa.</span>
        ) : status === "past_due" || status === "canceled" ? (
          <span className="text-amber-200">Tu prueba terminó, activá un plan para seguir usando el sistema.</span>
        ) : (
          <span>Prueba gratis 14 días incluida en el checkout.</span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {PLANS.map((item) => {
          const active = plan === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setPlan(item.id)}
              className={[
                "rounded-3xl border p-5 text-left transition",
                active
                  ? "border-[#59E0B8]/50 bg-[#59E0B8]/10 shadow-[0_0_0_1px_rgba(89,224,184,0.25)]"
                  : "border-white/10 bg-white/5 hover:bg-white/10",
              ].join(" ")}
            >
              <div className="text-lg font-semibold text-white/95">{item.title}</div>
              <div className="mt-1 text-sm text-white/80">{item.price}</div>
              <ul className="mt-3 space-y-1">
                {item.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-white/72">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#59E0B8]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={startCheckout} disabled={loading} className="dc-btn-primary">
          {loading ? "Redirigiendo..." : "Continuar a pago"}
        </button>
        <button type="button" onClick={() => navigate("/overview")} className="dc-btn-secondary">
          Volver al dashboard
        </button>
      </div>
    </div>
  );
}
