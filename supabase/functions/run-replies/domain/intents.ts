import { normalizeText } from "./normalization.ts";

export type Intent =
  | "greeting"
  | "acceptance"
  | "activation_interest"
  | "pricing"
  | "book_appointment"
  | "reschedule_appointment"
  | "cancel_appointment"
  | "hours"
  | "location"
  | "services"
  | "insurance"
  | "emergency"
  | "human_handoff"
  | "selected_pain"
  | "more_appointments"
  | "faster_replies"
  | "organization"
  | "follow_up"
  | "recommendation_request"
  | "revenue_question"
  | "pain_selection_confirmed"
  | "product_interest"
  | "why_question"
  | "confusion"
  | "skepticism"
  | "curiosity"
  | "demo_interest"
  | "trial_interest"
  | "onboarding_interest"
  | "pricing_interest"
  | "off_topic"
  | "unknown";

export type IntentResult = {
  intent: Intent;
  entities?: Record<string, string>;
};

const keywordList: Array<[Intent, string[]]> = [
  ["acceptance", [
    "si",
    "sí",
    "dale",
    "vale",
    "ok",
    "vamos",
    "me interesa",
    "quiero probarlo",
    "quiero probar",
    "probarlo",
    "quiero activarlo",
    "activarlo",
    "quiero que arranque",
    "quiero que empiece",
    "lo hacemos",
    "listo",
    "estoy listo",
  ]],
  ["activation_interest", [
    "cómo lo activo",
    "como lo activo",
    "cómo lo pongo en marcha",
    "como lo pongo en marcha",
    "quiero activarlo",
    "cómo empiezo",
    "como empiezo",
    "cómo lo inicio",
    "como lo inicio",
    "quiero empezar a usar",
  ]],
  ["greeting", ["hola", "hey", "buenas", "buen día"]],
  ["pricing", ["cuanto cuesta", "precio", "precios", "costos"]],
  ["book_appointment", ["agendar", "agenda", "cita", "reservar"]],
  ["reschedule_appointment", ["reagendar", "cambiar cita", "mover cita", "modificar cita"]],
  ["cancel_appointment", ["cancelar", "no puedo", "anular"]],
  ["hours", ["horarios", "abierto"]],
  ["location", ["ubicación", "dónde están", "direccion"]],
  ["services", ["servicios", "tratamientos", "especialidades"]],
  ["insurance", ["obra social", "seguro", "cobertura"]],
  ["emergency", ["urgencia", "emergencia", "dolor"]],
  ["human_handoff", ["hablar con", "humano", "asesor", "persona"]],
  ["selected_pain", ["responder", "seguimiento", "recordatorio", "citas"]],
  ["more_appointments", ["más citas", "conseguir más citas", "conseguir citas", "citas"]],
  ["faster_replies", ["responder más rápido", "contestar más rápido", "respuestas rápidas", "responder rápido"]],
  ["organization", ["organización", "más orden", "ordenar"]],
  ["follow_up", ["seguimiento", "dar seguimiento", "reenganchar"]],
  ["recommendation_request", [
    "qué me conviene",
    "qué me recomiendas",
    "qué da más resultado",
    "qué me genera más dinero",
  ]],
  ["revenue_question", [
    "qué es lo que más me generaría dinero",
    "qué me daría más ingresos",
    "más dinero",
  ]],
  ["pain_selection_confirmed", ["sí", "si", "correcto", "exacto", "citas"]],
  ["product_interest", ["qué hace", "cómo funciona", "háblame del producto"]],
  ["why_question", ["para que", "por que", "why", "para qué"]],
  ["confusion", ["no entiendo", "como funciona", "cómo funciona"]],
  ["skepticism", ["eso funciona", "eso sirve", "en serio"]],
  ["curiosity", ["como funciona", "qué hace", "que hace"]],
  ["demo_interest", ["quiero ver", "demo", "ver una demo", "mostrar"]],
  ["trial_interest", ["trial", "prueba", "quiero probar", "quiero un trial"]],
  ["onboarding_interest", ["quiero empezar", "activar", "comenzar", "empezar"]],
  ["pricing_interest", ["precio", "costos", "¿cuánto"]],
  ["off_topic", ["otra cosa", "lo otro"]],
  ["unknown", []],
];

export function detectIntent(text: string): IntentResult {
  const normalized = normalizeText(text);
  for (const [intent, phrases] of keywordList) {
    if (phrases.some((phrase) => normalized.includes(normalizeText(phrase)))) {
      return { intent };
    }
  }
  return { intent: "unknown" };
}
