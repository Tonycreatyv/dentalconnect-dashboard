import { normalizeText } from "../normalization.ts";

export type DentalTriageCategory =
  | "dental_pain"
  | "swelling"
  | "bleeding"
  | "broken_tooth"
  | "cavity_or_decay"
  | "cleaning"
  | "orthodontics"
  | "whitening"
  | "extraction"
  | "implant"
  | "general_checkup"
  | "unknown";

export type DentalTriageResult = {
  matched: boolean;
  category: DentalTriageCategory;
  service_suggestion: string | null;
  urgency: "routine" | "soon" | "urgent";
  symptoms: string[];
  safe_reply_hint: string;
  should_book: boolean;
};

function normalizeTriageText(text: string): string {
  return normalizeText(text)
    .toLowerCase()
    .replace(/\bteengo\b/g, "tengo")
    .replace(/\bmuelaa\b/g, "muela")
    .replace(/\bdientess?\b/g, "diente")
    .replace(/\bensia\b/g, "encia")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORIES: Array<{
  category: DentalTriageCategory;
  patterns: string[];
  service: string | null;
  urgency: "routine" | "soon" | "urgent";
  hint: string;
  shouldBook: boolean;
}> = [
  {
    category: "swelling",
    patterns: ["cara inflamada", "encia inflamada", "hinchado", "inflamacion"],
    service: "Revisión dental",
    urgency: "urgent",
    hint:
      "Lamento que estés pasando por eso. Por lo que contás, sería mejor revisarlo lo antes posible. Puedo ayudarte a agendar una cita prioritaria y buscar el primer espacio disponible.",
    shouldBook: true,
  },
  {
    category: "bleeding",
    patterns: ["sangrado", "me sangra", "sangre en la encia"],
    service: "Revisión dental",
    urgency: "urgent",
    hint:
      "Entiendo. Eso conviene revisarlo cuanto antes. Puedo ayudarte a agendar una revisión dental prioritaria.",
    shouldBook: true,
  },
  {
    category: "dental_pain",
    patterns: [
      "me duele una muela",
      "dolor de muela",
      "me duele el diente",
      "dolor fuerte",
      "no aguanto el dolor",
      "me duele la encia",
      "punzadas",
    ],
    service: "Revisión dental",
    urgency: "soon",
    hint:
      "Entiendo, eso conviene revisarlo pronto. Puedo ayudarte a agendar una revisión dental.",
    shouldBook: true,
  },
  {
    category: "broken_tooth",
    patterns: ["diente quebrado", "diente roto", "se me quebro una muela", "diente partido"],
    service: "Revisión dental",
    urgency: "soon",
    hint:
      "Entiendo, eso conviene revisarlo a tiempo. Puedo ayudarte a agendar una revisión dental.",
    shouldBook: true,
  },
  {
    category: "cavity_or_decay",
    patterns: [
      "tengo picado el diente",
      "teengo picado el diente",
      "diente picado",
      "muela picada",
      "se me pico una muela",
      "caries",
      "hoyo en el diente",
      "hueco en la muela",
    ],
    service: "Revisión dental",
    urgency: "soon",
    hint:
      "Entiendo, eso conviene revisarlo a tiempo. Puedo ayudarte a agendar una revisión dental.",
    shouldBook: true,
  },
  {
    category: "cleaning",
    patterns: ["limpieza", "limpieza dental", "sarro", "profilaxis", "quitar sarro"],
    service: "Limpieza dental",
    urgency: "routine",
    hint: "Perfecto. Puedo ayudarte a agendar una limpieza dental.",
    shouldBook: true,
  },
  {
    category: "orthodontics",
    patterns: ["brackets", "frenillos", "ortodoncia", "retenedores"],
    service: "Ortodoncia / brackets",
    urgency: "routine",
    hint: "Perfecto. Puedo ayudarte a agendar una evaluación de ortodoncia/brackets.",
    shouldBook: true,
  },
  {
    category: "whitening",
    patterns: ["blanqueamiento", "dientes blancos", "whitening"],
    service: "Blanqueamiento dental",
    urgency: "routine",
    hint: "Perfecto. Puedo ayudarte a agendar una cita para blanqueamiento.",
    shouldBook: true,
  },
  {
    category: "extraction",
    patterns: ["sacar una muela", "extraccion", "extraer diente", "muela del juicio"],
    service: "Extracción dental",
    urgency: "soon",
    hint: "Entiendo. Puedo ayudarte a agendar una evaluación para extracción.",
    shouldBook: true,
  },
  {
    category: "implant",
    patterns: ["implante", "implantes"],
    service: "Implantes",
    urgency: "routine",
    hint: "Perfecto. Puedo ayudarte a agendar una evaluación para implantes.",
    shouldBook: true,
  },
  {
    category: "general_checkup",
    patterns: ["revision", "chequeo", "consulta", "evaluacion"],
    service: "Revisión dental",
    urgency: "routine",
    hint: "Perfecto. Puedo ayudarte a agendar una revisión dental.",
    shouldBook: true,
  },
];

export function classifyDentalPatientMessage(text: string): DentalTriageResult {
  const normalized = normalizeTriageText(text);
  if (!normalized) {
    return {
      matched: false,
      category: "unknown",
      service_suggestion: null,
      urgency: "routine",
      symptoms: [],
      safe_reply_hint: "",
      should_book: false,
    };
  }

  for (const c of CATEGORIES) {
    const hits = c.patterns.filter((p) => normalized.includes(p));
    if (!hits.length) continue;
    const strongUrgency =
      c.category === "dental_pain" &&
      /\b(dolor fuerte|no aguanto el dolor|cara inflamada|sangrado)\b/.test(normalized);
    return {
      matched: true,
      category: c.category,
      service_suggestion: c.service,
      urgency: strongUrgency ? "urgent" : c.urgency,
      symptoms: hits,
      safe_reply_hint: c.hint,
      should_book: c.shouldBook,
    };
  }

  return {
    matched: false,
    category: "unknown",
    service_suggestion: null,
    urgency: "routine",
    symptoms: [],
    safe_reply_hint: "",
    should_book: false,
  };
}
