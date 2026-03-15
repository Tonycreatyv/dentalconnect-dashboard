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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-lg border-b border-slate-200 safe-area-top">
        <div className="flex items-center gap-3 px-4 py-4 max-w-5xl mx-auto">
          <button onClick={() => navigate("/overview")} className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 transition">
            <ArrowLeft className="h-5 w-5 text-slate-700" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Elige tu plan</h1>
            <p className="text-sm text-slate-500">Prueba gratis por 14 días</p>
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
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            La recepcionista que nunca duerme
          </h2>
          <p className="text-slate-600 max-w-xl mx-auto">
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
                      ? "border-blue-500 bg-blue-50 shadow-lg shadow-blue-100"
                      : "border-slate-900 bg-white shadow-lg"
                    : "border-slate-200 bg-white hover:border-slate-300"
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
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                      Actual
                    </span>
                  </div>
                )}

                <div className="mb-4">
                  <div className="text-lg font-bold text-slate-900">{plan.name}</div>
                  <div className="text-sm text-slate-500">{plan.description}</div>
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-bold text-slate-900">${plan.price}</span>
                  <span className="text-slate-500">/{plan.period}</span>
                </div>

                <div className="space-y-2">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className={`flex items-center justify-center w-5 h-5 rounded-full ${feature.included ? "bg-emerald-100" : "bg-slate-100"}`}>
                        {feature.included ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <span className="w-1.5 h-0.5 bg-slate-300 rounded-full" />
                        )}
                      </div>
                      <span className={`text-sm ${feature.included ? "text-slate-700" : "text-slate-400"}`}>
                        {feature.text}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Selection indicator */}
                <div className={`mt-4 flex items-center justify-center h-10 rounded-xl font-medium text-sm transition ${
                  isSelected
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}>
                  {isSelected ? "Seleccionado" : "Seleccionar"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Summary and CTA */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="text-sm text-slate-500 mb-1">Plan seleccionado</div>
              <div className="text-2xl font-bold text-slate-900">
                {selectedPlanData.name} - ${selectedPlanData.price}/mes
              </div>
              <div className="text-sm text-emerald-600 font-medium mt-1">
                ✓ 14 días de prueba gratis incluidos
              </div>
            </div>

            <button
              onClick={startCheckout}
              disabled={loading}
              className="flex items-center justify-center gap-2 h-14 px-8 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-lg hover:opacity-90 disabled:opacity-50 transition shadow-lg shadow-blue-200"
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
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm mb-4">
              {error}
            </div>
          )}

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 pt-4 border-t border-slate-100">
            {TRUST_BADGES.map((badge, idx) => {
              const Icon = badge.icon;
              return (
                <div key={idx} className="flex items-center gap-2 text-slate-500 text-sm">
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
              <div key={idx} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 text-blue-600 mb-3">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="font-semibold text-slate-900 mb-1">{item.title}</div>
                <div className="text-sm text-slate-500">{item.description}</div>
              </div>
            );
          })}
        </div>

        {/* Testimonials */}
        <div className="bg-slate-50 rounded-2xl p-6">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-1 mb-2">
              {[1,2,3,4,5].map(i => <Star key={i} className="h-5 w-5 text-amber-400 fill-amber-400" />)}
            </div>
            <div className="text-sm text-slate-600">+100 clínicas confían en nosotros</div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {TESTIMONIALS.map((t, idx) => (
              <div key={idx} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500 mb-2">{t.clinic}</div>
                    <div className="text-sm text-slate-700">"{t.text}"</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-slate-900 text-center">Preguntas frecuentes</h3>
          {[
            { q: "¿Puedo cancelar cuando quiera?", a: "Sí, puedes cancelar en cualquier momento. Sin contratos ni penalidades." },
            { q: "¿Qué pasa después de los 14 días?", a: "Se cobra el plan elegido. Si cancelas antes, no se cobra nada." },
            { q: "¿Necesito tarjeta de crédito para la prueba?", a: "Sí, pero no se hace ningún cobro hasta que termine la prueba." },
          ].map((faq, idx) => (
            <details key={idx} className="bg-white rounded-xl border border-slate-200 p-4 group">
              <summary className="font-medium text-slate-900 cursor-pointer list-none flex items-center justify-between">
                {faq.q}
                <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <p className="text-sm text-slate-600 mt-2">{faq.a}</p>
            </details>
          ))}
        </div>

        {/* Final CTA */}
        <div className="text-center py-8">
          <button
            onClick={startCheckout}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 h-14 px-8 rounded-xl bg-slate-900 text-white font-semibold text-lg hover:bg-slate-800 disabled:opacity-50 transition"
          >
            <Sparkles className="h-5 w-5" />
            Comenzar ahora
          </button>
          <p className="text-sm text-slate-500 mt-3">
            Sin riesgos. Cancela cuando quieras.
          </p>
        </div>
      </div>
    </div>
  );
}