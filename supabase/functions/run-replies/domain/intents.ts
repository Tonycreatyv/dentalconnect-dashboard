import { normalizeText } from "./normalization.ts";

export type Intent =
  | "human_handoff"
  | "emergency"
  | "pricing"
  | "services"
  | "book_appointment"
  | "demo_interest"
  | "trial_interest"
  | "how_it_works"
  | "confirmation"
  | "denial"
  | "more_appointments"
  | "faster_replies"
  | "follow_up"
  | "hours"
  | "location"
  | "insurance"
  | "gratitude"
  | "confusion"
  | "greeting"
  | "unknown";

export type IntentResult = {
  intent: Intent;
  confidence: number;
  priority: number;
};

const intentPatterns: Array<{
  intent: Intent;
  priority: number;
  patterns: string[];
  exactMatch?: boolean;
}> = [
  {
    intent: "human_handoff",
    priority: 1,
    patterns: ["hablar con alguien", "hablar con una persona", "quiero hablar con", "pasame con", "asesor", "agente", "humano", "operador"],
  },
  {
    intent: "emergency",
    priority: 1,
    patterns: ["urgencia", "emergencia", "dolor fuerte", "me duele mucho", "es urgente"],
  },
  {
    intent: "pricing",
    priority: 2,
    patterns: ["cuanto cuesta", "cuánto cuesta", "precio", "precios", "costos", "tarifas", "cuanto sale", "planes"],
  },
  {
    intent: "services",
    priority: 2,
    patterns: ["qué servicios", "que servicios", "qué ofrecen", "que ofrecen", "servicios", "tratamientos"],
  },
  {
    intent: "book_appointment",
    priority: 2,
    patterns: ["agendar cita", "reservar cita", "quiero una cita", "necesito una cita", "sacar turno"],
  },
  {
    intent: "demo_interest",
    priority: 3,
    patterns: ["quiero ver", "demo", "mostrame", "muéstrame", "ver cómo funciona"],
  },
  {
    intent: "trial_interest",
    priority: 3,
    patterns: ["quiero probar", "probarlo", "prueba gratis", "trial"],
  },
  {
    intent: "how_it_works",
    priority: 3,
    patterns: ["cómo funciona", "como funciona", "explicame", "qué es esto"],
  },
  {
    intent: "confirmation",
    priority: 4,
    patterns: ["si", "sí", "ok", "dale", "vale", "claro", "perfecto", "está bien", "de acuerdo", "listo", "bueno"],
    exactMatch: true,
  },
  {
    intent: "denial",
    priority: 4,
    patterns: ["no", "no gracias", "no me interesa", "ahora no", "después"],
    exactMatch: true,
  },
  {
    intent: "more_appointments",
    priority: 5,
    patterns: ["más citas", "conseguir más citas", "llenar agenda", "más pacientes"],
  },
  {
    intent: "faster_replies",
    priority: 5,
    patterns: ["responder más rápido", "contestar más rápido", "no me da tiempo"],
  },
  {
    intent: "follow_up",
    priority: 5,
    patterns: ["seguimiento", "pacientes que no vuelven", "recordatorios"],
  },
  {
    intent: "hours",
    priority: 6,
    patterns: ["horario", "horarios", "a qué hora abren"],
  },
  {
    intent: "location",
    priority: 6,
    patterns: ["dónde están", "ubicación", "dirección"],
  },
  {
    intent: "insurance",
    priority: 6,
    patterns: ["seguro", "obra social", "cobertura"],
  },
  {
    intent: "gratitude",
    priority: 8,
    patterns: ["gracias", "muchas gracias", "te agradezco"],
  },
  {
    intent: "confusion",
    priority: 8,
    patterns: ["no entiendo", "me perdí", "qué?"],
  },
  {
    intent: "greeting",
    priority: 9,
    patterns: ["hola", "hey", "buenas", "buen día", "buenos días", "qué tal"],
  },
];

export function detectIntent(text: string, context?: { nextExpected?: string }): IntentResult {
  const normalized = normalizeText(text).toLowerCase().trim();
  const words = normalized.split(/\s+/);
  const isShortResponse = words.length <= 3;

  const sortedPatterns = [...intentPatterns].sort((a, b) => a.priority - b.priority);

  for (const { intent, priority, patterns, exactMatch } of sortedPatterns) {
    for (const pattern of patterns) {
      const normalizedPattern = normalizeText(pattern).toLowerCase();
      if (exactMatch) {
        if (isShortResponse && (normalized === normalizedPattern || normalized.startsWith(normalizedPattern))) {
          return { intent, confidence: context?.nextExpected ? 0.95 : 0.8, priority };
        }
      } else {
        if (normalized.includes(normalizedPattern)) {
          return { intent, confidence: 0.9, priority };
        }
      }
    }
  }
  return { intent: "unknown", confidence: 0.1, priority: 99 };
}

export function isHighValueIntent(intent: Intent): boolean {
  return ["pricing", "book_appointment", "demo_interest", "trial_interest", "services"].includes(intent);
}

export function needsHumanHandoff(intent: Intent): boolean {
  return intent === "human_handoff" || intent === "emergency";
}

export function isContinuationResponse(intent: Intent): boolean {
  return intent === "confirmation" || intent === "denial";
}