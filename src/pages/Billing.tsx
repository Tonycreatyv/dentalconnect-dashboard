import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, Check, Crown, Zap, Shield, Clock, 
  MessageCircle, Calendar, TrendingUp, Star, Users,
  ChevronRight, Sparkles, Lock
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";

const DEFAULT_ORG = "clinic-demo";

type Plan = "starter" | "growth" | "pro";
type BillingStatus = "trialing" | "active" | "past_due" | "canceled";

const PLANS = [
  {
    id: "starter" as Plan,
    name: "Starter",
    price: 49,
    period: "mes",
    description: "Perfecto para empezar",
    highlight: false,
    features: [
      { text: "Inbox centralizado", included: true },
      { text: "Agenda inteligente", included: true },
      { text: "Hasta 100 leads/mes", included: true },
      { text: "Reportes básicos", included: true },
      { text: "Automatizaciones IA", included: false },
      { text: "Marketing IA", included: false },
    ],
  },
  {
    id: "growth" as Plan,
    name: "Growth",
    price: 99,
    period: "mes",
    description: "El más popular",
    highlight: true,
    badge: "Recomendado",
    features: [
      { text: "Todo de Starter", included: true },
      { text: "Leads ilimitados", included: true },
      { text: "Automatizaciones IA", included: true },
      { text: "Integraciones sociales", included: true },
      { text: "Seguimiento avanzado", included: true },
      { text: "Marketing IA básico", included: true },
    ],
  },
  {
    id: "pro" as Plan,
    name: "Pro",
    price: 199,
    period: "mes",
    description: "Máximo poder",
    highlight: false,
    features: [
      { text: "Todo de Growth", included: true },
      { text: "Marketing IA completo", included: true },
      { text: "Workflows automáticos", included: true },
      { text: "API access", included: true },
      { text: "Soporte prioritario", included: true },
      { text: "Onboarding dedicado", included: true },
    ],
  },
];

const TESTIMONIALS = [
  { name: "Dra. María García", clinic: "Clínica Dental Sonrisas", text: "Reducimos los no-shows en un 60% desde que usamos Creatyv.", avatar: "M" },
  { name: "Dr. Carlos López", clinic: "Centro Dental Premium", text: "El bot responde 24/7 y mis pacientes están más satisfechos.", avatar: "C" },
];

const TRUST_BADGES = [
  { icon: Shield, text: "Datos seguros" },
  { icon: Lock, text: "Cifrado SSL" },
  { icon: Clock, text: "Soporte 24/7" },
];

export default function Billing() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [selectedPlan, setSelectedPlan] = useState<Plan>("growth");
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trialDaysLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }, [trialEndsAt]);

  useEffect(() => {
    async function load() {
      const sub = await supabase
        .from("subscriptions")
        .select("plan, status, trial_ends_at")
        .eq("organization_id", ORG)
        .maybeSingle();

      if (!sub.error && sub.data) {
        const plan = sub.data.plan as Plan;
        if (["starter", "growth", "pro"].includes(plan)) {
          setCurrentPlan(plan);
          setSelectedPlan(plan);
        }
        setStatus(sub.data.status as BillingStatus);
        setTrialEndsAt(sub.data.trial_ends_at);
      }
    }
    load();
  }, [ORG]);

  async function startCheckout() {
    setError(null);
    setLoading(true);

    const res = await supabase.functions.invoke("stripe-checkout", {
      body: { organization_id: ORG, plan: selectedPlan },
    });

    setLoading(false);

    if (res.error || !res.data?.url) {
      setError("No se pudo iniciar el pago. Por favor intenta nuevamente.");
      return;
    }

    window.location.href = res.data.url;
  }

  const selectedPlanData = PLANS.find(p => p.id === selectedPlan)!;

  return (
    <div className="min-h-screen bg-[#0B1117] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[#0B1117]/90 backdrop-blur-lg safe-area-top">
        <div className="flex items-center gap-3 px-4 py-4 max-w-5xl mx-auto">
          <button onClick={() => navigate("/overview")} className="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition">
            <ArrowLeft className="h-5 w-5 text-white/80" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Elige tu plan</h1>
            <p className="text-sm text-white/50">Prueba gratis por 14 días</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        {/* Current status banner */}
        {status === "trialing" && trialDaysLeft !== null && (
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold">Tu prueba gratis está activa</div>
                <div className="text-sm text-white/80">Te quedan {trialDaysLeft} días. Elige un plan para continuar.</div>
              </div>
            </div>
          </div>
        )}

        {status === "past_due" && (
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-4 text-white">
            <div className="flex items-center gap-3">
              <Zap className="h-6 w-6" />
              <div>
                <div className="font-semibold">Tu prueba terminó</div>
                <div className="text-sm text-white/80">Activa un plan para seguir usando todas las funciones.</div>
              </div>
            </div>
          </div>
        )}

        {/* Value proposition */}
        <div className="text-center py-4">
          <h2 className="mb-2 text-2xl font-bold text-white">
            La recepcionista que nunca duerme
          </h2>
          <p className="mx-auto max-w-xl text-white/60">
            Automatiza respuestas, reduce no-shows y llena tu agenda sin esfuerzo.
            Únete a +100 clínicas que ya confían en nosotros.
          </p>
        </div>

        {/* Plans */}
        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const isCurrent = currentPlan === plan.id;

            return (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={`relative text-left rounded-2xl border-2 p-5 transition-all ${
                  isSelected
                    ? plan.highlight
                      ? "border-blue-400/20 bg-blue-500/10 shadow-none"
                      : "border-white/10 bg-white/5 shadow-none"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                      <Star className="h-3 w-3" />
                      {plan.badge}
                    </span>
                  </div>
                )}

                {/* Current badge */}
                {isCurrent && (
                  <div className="absolute top-3 right-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      Actual
                    </span>
                  </div>
                )}

                <div className="mb-4">
                  <div className="text-lg font-bold text-white">{plan.name}</div>
                  <div className="text-sm text-white/50">{plan.description}</div>
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-bold text-white">${plan.price}</span>
                  <span className="text-white/50">/{plan.period}</span>
                </div>

                <div className="space-y-2">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className={`flex items-center justify-center w-5 h-5 rounded-full ${feature.included ? "bg-emerald-500/10" : "bg-white/10"}`}>
                        {feature.included ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <span className="h-0.5 w-1.5 rounded-full bg-white/30" />
                        )}
                      </div>
                      <span className={`text-sm ${feature.included ? "text-white/80" : "text-white/40"}`}>
                        {feature.text}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Selection indicator */}
                <div className={`mt-4 flex items-center justify-center h-10 rounded-xl font-medium text-sm transition ${
                  isSelected
                    ? "bg-[#3CBDB9] text-white"
                    : "bg-white/10 text-white/50"
                }`}>
                  {isSelected ? "Seleccionado" : "Seleccionar"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Summary and CTA */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-none">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="mb-1 text-sm text-white/50">Plan seleccionado</div>
              <div className="text-2xl font-bold text-white">
                {selectedPlanData.name} - ${selectedPlanData.price}/mes
              </div>
              <div className="mt-1 text-sm font-medium text-emerald-400">
                ✓ 14 días de prueba gratis incluidos
              </div>
            </div>

            <button
              onClick={startCheckout}
              disabled={loading}
              className="flex items-center justify-center gap-2 h-14 px-8 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-lg hover:opacity-90 disabled:opacity-50 transition shadow-none shadow-blue-200"
            >
              {loading ? (
                "Procesando..."
              ) : (
                <>
                  Comenzar prueba gratis
                  <ChevronRight className="h-5 w-5" />
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-400">
              {error}
            </div>
          )}

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 border-t border-white/10 pt-4">
            {TRUST_BADGES.map((badge, idx) => {
              const Icon = badge.icon;
              return (
                <div key={idx} className="flex items-center gap-2 text-sm text-white/50">
                  <Icon className="h-4 w-4" />
                  <span>{badge.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Features highlight */}
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { icon: MessageCircle, title: "Bot 24/7", description: "Responde automáticamente mientras duermes" },
            { icon: Calendar, title: "Menos no-shows", description: "Confirmaciones automáticas reducen cancelaciones" },
            { icon: TrendingUp, title: "Más pacientes", description: "Convierte leads en citas sin esfuerzo" },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <div key={idx} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mb-1 font-semibold text-white">{item.title}</div>
                <div className="text-sm text-white/50">{item.description}</div>
              </div>
            );
          })}
        </div>

        {/* Testimonials */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-1 mb-2">
              {[1,2,3,4,5].map(i => <Star key={i} className="h-5 w-5 text-amber-400 fill-amber-400" />)}
            </div>
            <div className="text-sm text-white/60">+100 clínicas confían en nosotros</div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {TESTIMONIALS.map((t, idx) => (
              <div key={idx} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 font-bold text-blue-400">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-white">{t.name}</div>
                    <div className="mb-2 text-xs text-white/50">{t.clinic}</div>
                    <div className="text-sm text-white/80">"{t.text}"</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="space-y-4">
          <h3 className="text-center text-lg font-bold text-white">Preguntas frecuentes</h3>
          {[
            { q: "¿Puedo cancelar cuando quiera?", a: "Sí, puedes cancelar en cualquier momento. Sin contratos ni penalidades." },
            { q: "¿Qué pasa después de los 14 días?", a: "Se cobra el plan elegido. Si cancelas antes, no se cobra nada." },
            { q: "¿Necesito tarjeta de crédito para la prueba?", a: "Sí, pero no se hace ningún cobro hasta que termine la prueba." },
          ].map((faq, idx) => (
            <details key={idx} className="group rounded-xl border border-white/10 bg-white/5 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-white">
                {faq.q}
                <ChevronRight className="h-4 w-4 text-white/40 transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-2 text-sm text-white/60">{faq.a}</p>
            </details>
          ))}
        </div>

        {/* Final CTA */}
        <div className="text-center py-8">
          <button
            onClick={startCheckout}
            disabled={loading}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-[#3CBDB9] px-8 text-lg font-semibold text-white transition hover:bg-[#35a9a5] disabled:opacity-50"
          >
            <Sparkles className="h-5 w-5" />
            Comenzar ahora
          </button>
          <p className="mt-3 text-sm text-white/50">
            Sin riesgos. Cancela cuando quieras.
          </p>
        </div>
      </div>
    </div>
  );
}
