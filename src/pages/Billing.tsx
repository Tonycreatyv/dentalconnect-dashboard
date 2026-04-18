import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, Shield, Clock, MessageCircle, Calendar,
  TrendingUp, Users, Sparkles, Zap, Lock,
  Bot, Bell, BarChart3, Headphones, Star
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import PageHeader from "../components/PageHeader";

const DEFAULT_ORG = "clinic-demo";
type BillingStatus = "trialing" | "active" | "past_due" | "canceled";

const FEATURES = [
  { icon: Bot, text: "Asistente IA 24/7 en Messenger" },
  { icon: MessageCircle, text: "Inbox centralizado — todos los mensajes en un solo lugar" },
  { icon: Calendar, text: "Agenda inteligente con vista día, semana y mes" },
  { icon: Bell, text: "Recordatorios automáticos antes de cada cita" },
  { icon: Users, text: "Gestión de pacientes y leads" },
  { icon: TrendingUp, text: "Leads ilimitados — nunca pierdas un paciente" },
  { icon: Zap, text: "Follow-ups automáticos inteligentes" },
  { icon: Headphones, text: "Soporte dedicado" },
];

const COMPARISON = [
  { label: "Responde 24/7", creatyv: true, recep: false, agency: false },
  { label: "Agenda citas automáticamente", creatyv: true, recep: true, agency: false },
  { label: "Recordatorios automáticos", creatyv: true, recep: false, agency: true },
  { label: "Gestión de pacientes", creatyv: true, recep: false, agency: false },
  { label: "Messenger integrado", creatyv: true, recep: false, agency: true },
  { label: "Follow-ups automáticos", creatyv: true, recep: false, agency: false },
  { label: "Nunca se enferma ni falta", creatyv: true, recep: false, agency: false },
];

const FAQ = [
  { q: "¿Qué pasa si cancelo?", a: "Sin contratos ni penalidades. Cancelás cuando quieras y tu clínica sigue funcionando hasta el final del período pagado." },
  { q: "¿Qué pasa después de los 12 meses del founders price?", a: "El precio pasa al plan regular. Pero si renovás antes de que se cumpla el año, te mantenemos el precio." },
  { q: "¿Necesito WhatsApp Business?", a: "No. Podés empezar solo con Messenger o usar la app como calendario y CRM sin ningún canal de mensajería." },
  { q: "¿Cuánto tarda la configuración?", a: "Menos de 15 minutos. Conectás tu página de Facebook, configurás horarios y servicios, y el bot empieza a responder." },
  { q: "¿Mis datos están seguros?", a: "Sí. Usamos cifrado SSL y Row Level Security. Tus datos son tuyos y nunca los compartimos." },
];

const TOTAL_SLOTS = 10;
const CLAIMED_SLOTS = 7;

const PLANS = [
  {
    id: "starter", checkoutUrl: "https://creatyv.lemonsqueezy.com/checkout/buy/3d164ed5-85ac-4a42-a94c-a34ade5c4fc7",
    name: "Especialista",
    price: 79,
    doctorLimit: 1,
    description: "1 doctor + 1 recepcionista",
    features: ["1 doctor", "1 recepcionista", "Messenger", "Reminders automáticos", "CRM básico", "Soporte por email"],
    highlight: false,
  },
  {
    id: "growth", checkoutUrl: "https://creatyv.lemonsqueezy.com/checkout/buy/151e1ebc-2a05-4dc0-8ad0-c8d289ecaf9e",
    name: "Clínica Pro",
    price: 149,
    doctorLimit: 5,
    description: "Hasta 5 doctores + 1 recepcionista",
    features: ["Hasta 5 doctores", "1 recepcionista", "Messenger", "Reminders 72h/24h/2h", "CRM completo", "Reportes", "Soporte prioritario"],
    highlight: true,
  },
  {
    id: "pro", checkoutUrl: "https://creatyv.lemonsqueezy.com/checkout/buy/b370f675-8b53-4bcb-b4ef-0546f4016675",
    name: "Full Clinic",
    price: 299,
    doctorLimit: 15,
    description: "Hasta 15 doctores, todo incluido",
    features: ["Hasta 15 doctores", "Recepcionistas ilimitadas", "WhatsApp + Messenger", "Google Calendar sync", "Reminders 72h/24h/2h", "CRM completo", "Soporte VIP 24/7"],
    highlight: false,
  },
];

export default function Billing() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spotsLeft = TOTAL_SLOTS - CLAIMED_SLOTS;
  const progressPercent = (CLAIMED_SLOTS / TOTAL_SLOTS) * 100;

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
        setStatus(sub.data.status as BillingStatus);
        setCurrentPlan(sub.data.plan);
        setTrialEndsAt(sub.data.trial_ends_at ?? null);
      }
    }
    void load();
  }, [ORG]);

  function handleSubscribe(planId: string) {
    const plan = PLANS.find(p => p.id === planId);
    if ((plan as any)?.checkoutUrl) {
      window.location.href = (plan as any).checkoutUrl;
    }
  }
  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Plan y Facturación"
        subtitle="Un solo sistema. Todo incluido. Sin sorpresas."
      />

      {status === "trialing" && trialDaysLeft !== null && (
        <div className="rounded-2xl border border-[#3CBDB9]/30 bg-[#3CBDB9]/10 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-[#3CBDB9]">Período de prueba activo</div>
              <div className="mt-1 text-sm text-white/60">
                Te quedan <span className="font-bold text-white">{trialDaysLeft} días</span> de prueba gratuita.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Urgency bar */}
      <div className="rounded-2xl border border-[#3CBDB9]/20 bg-[#3CBDB9]/5 px-6 py-4">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-white/50">Espacios founders ocupados</span>
          <span className="text-[#3CBDB9] font-semibold">⚡ Solo quedan {spotsLeft} espacios</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#3CBDB9] to-[#34d399] transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-2 text-xs text-white/30">2 clínicas evaluando este plan esta semana · Última registrada hace 2 días</div>
      </div>

      {/* Plans grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const price = plan.price;
          const isActive = currentPlan === plan.id && (status === "active" || status === "trialing");

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 transition-all ${
                plan.highlight
                  ? "border-[#3CBDB9] bg-gradient-to-b from-[#3CBDB9]/10 to-transparent"
                  : "border-white/10 bg-white/5"
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#3CBDB9] px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-[#0B1117]">
                  Más popular
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <div className="text-sm font-semibold text-white/50 uppercase tracking-wider">{plan.name}</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold text-white">${price}</span>
                    <span className="text-white/40">/mes</span>
                  </div>
                  <div className="mt-1 text-xs text-white/40">{plan.description}</div>
                </div>

                <ul className="space-y-2">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-white/60">
                      <Check className="h-3.5 w-3.5 shrink-0 text-[#3CBDB9]" />
                      {f}
                    </li>
                  ))}
                </ul>

                {isActive ? (
                  <div className="w-full rounded-xl border border-emerald-400/20 bg-emerald-500/10 py-3 text-center text-sm font-semibold text-emerald-400">
                    ✓ Plan activo
                  </div>
                ) : (
                  <button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={loading === plan.id}
                    className={`w-full rounded-xl py-3 text-sm font-bold transition-colors disabled:opacity-50 ${
                      plan.highlight
                        ? "bg-[#3CBDB9] text-[#0B1117] hover:bg-[#35a9a5]"
                        : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
                    }`}
                  >
                    {loading === plan.id ? "Procesando..." : "Empezar 14 días gratis"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center text-xs text-white/30">
        14 días gratis en todos los planes · Sin contratos · Cancelá cuando quieras
      </div>

      {/* Features */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <div className="text-lg font-bold text-white mb-1">Todo incluido en todos los planes</div>
        <div className="text-sm text-white/50 mb-6">Sin upgrades, sin features bloqueados.</div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3CBDB9]/10">
                <feature.icon className="h-4 w-4 text-[#3CBDB9]" />
              </div>
              <span className="text-sm text-white/70 leading-relaxed">{feature.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <div className="text-lg font-bold text-white mb-6">¿Por qué Creatyv?</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 pr-4 text-white/50 font-medium">Característica</th>
                <th className="py-3 px-4 text-center"><span className="text-[#3CBDB9] font-bold">Creatyv</span><div className="text-white/30 text-xs mt-0.5">$79-249/mes</div></th>
                <th className="py-3 px-4 text-center"><span className="text-white/50 font-medium">Recepcionista</span><div className="text-white/30 text-xs mt-0.5">$400-600/mes</div></th>
                <th className="py-3 px-4 text-center"><span className="text-white/50 font-medium">Agencia</span><div className="text-white/30 text-xs mt-0.5">$300-800/mes</div></th>
              </tr>
            </thead>
            <tbody className="text-white/60">
              {COMPARISON.map((row, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-3 pr-4">{row.label}</td>
                  <td className="py-3 px-4 text-center">{row.creatyv ? <Check className="h-4 w-4 text-[#3CBDB9] mx-auto" /> : <span className="text-white/20">—</span>}</td>
                  <td className="py-3 px-4 text-center">{row.recep ? <Check className="h-4 w-4 text-white/30 mx-auto" /> : <span className="text-white/20">—</span>}</td>
                  <td className="py-3 px-4 text-center">{row.agency ? <Check className="h-4 w-4 text-white/30 mx-auto" /> : <span className="text-white/20">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6">
        {[{ icon: Shield, text: "Datos seguros" }, { icon: Lock, text: "Cifrado SSL" }, { icon: Clock, text: "Soporte incluido" }].map((badge, i) => (
          <div key={i} className="flex items-center gap-2 text-white/30 text-sm">
            <badge.icon className="h-4 w-4" />
            <span>{badge.text}</span>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <div className="text-lg font-bold text-white mb-6">Preguntas frecuentes</div>
        <div className="space-y-6">
          {FAQ.map(({ q, a }, i) => (
            <div key={i}>
              <div className="text-sm font-semibold text-white">{q}</div>
              <div className="mt-1 text-sm text-white/50 leading-relaxed">{a}</div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
    </div>
  );
}
