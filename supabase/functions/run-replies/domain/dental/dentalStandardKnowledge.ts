import type { DentalClinicalCategory, DentalUrgency } from "../interpreter/dentalInterpreterTypes.ts";

type CategoryConfig = {
  service_suggestion: string | null;
  default_urgency: DentalUrgency;
  urgent_signals?: string[];
  examples: string[];
  safe_reply_hint: string;
};

export const DENTAL_STANDARD_CATEGORIES: Partial<Record<DentalClinicalCategory, CategoryConfig>> = {
  dental_pain: {
    service_suggestion: "Revisión dental",
    default_urgency: "soon",
    urgent_signals: ["dolor fuerte", "no aguanto", "cara inflamada", "hinchado"],
    examples: ["me duele una muela", "me duele la muela", "dolor de muela", "me duele el diente", "me duele la encia", "punzadas"],
    safe_reply_hint: "Entiendo, eso puede ser incómodo. Lo mejor es revisarlo a tiempo para evitar que empeore.",
  },
  swelling: {
    service_suggestion: "Revisión dental",
    default_urgency: "urgent",
    examples: ["cara inflamada", "encia inflamada", "tengo hinchada la cara", "inflamacion"],
    safe_reply_hint: "Lamento que estés pasando por eso. Por lo que contás, sería mejor revisarlo lo antes posible.",
  },
  bleeding: {
    service_suggestion: "Revisión dental",
    default_urgency: "urgent",
    examples: ["me sangra la encia", "sangrado", "me sale sangre"],
    safe_reply_hint: "Eso conviene revisarlo pronto, especialmente si el sangrado continúa.",
  },
  broken_tooth: {
    service_suggestion: "Revisión dental",
    default_urgency: "soon",
    examples: ["se me quebro un diente", "diente quebrado", "diente roto", "diente partido", "muela quebrada"],
    safe_reply_hint: "Entiendo. Cuando un diente se quiebra, lo mejor es que lo revise la clínica.",
  },
  cavity_or_decay: {
    service_suggestion: "Revisión dental",
    default_urgency: "soon",
    examples: [
      "tengo picado el diente",
      "teengo picado el diente",
      "diente picado",
      "muela picada",
      "se me pico una muela",
      "tengo caries",
      "caries",
      "creo que tengo caries",
      "hoyo en el diente",
      "hueco en la muela",
    ],
    safe_reply_hint: "Entiendo, eso conviene revisarlo a tiempo. Puedo ayudarte a agendar una revisión dental.",
  },
  cleaning: {
    service_suggestion: "Limpieza dental",
    default_urgency: "routine",
    examples: ["limpieza", "limpieza dental", "sarro", "profilaxis", "quitar sarro"],
    safe_reply_hint: "Claro, puedo ayudarte a revisar horarios para una limpieza dental.",
  },
  orthodontics: {
    service_suggestion: "Ortodoncia / brackets",
    default_urgency: "routine",
    examples: ["brackets", "frenillos", "ortodoncia", "retenedores"],
    safe_reply_hint: "Claro, puedo ayudarte a revisar horarios para ortodoncia.",
  },
  whitening: {
    service_suggestion: "Blanqueamiento dental",
    default_urgency: "routine",
    examples: ["blanqueamiento", "dientes blancos", "whitening"],
    safe_reply_hint: "Claro, puedo ayudarte con información o disponibilidad para blanqueamiento.",
  },
  extraction: {
    service_suggestion: "Extracción dental",
    default_urgency: "soon",
    examples: ["sacar una muela", "extraccion", "extraer diente", "muela del juicio"],
    safe_reply_hint: "Ese caso normalmente requiere evaluación para confirmar el procedimiento correcto.",
  },
  general_checkup: {
    service_suggestion: "Revisión dental",
    default_urgency: "routine",
    examples: ["revision", "chequeo", "consulta", "evaluacion"],
    safe_reply_hint: "Claro, puedo ayudarte a revisar horarios para una revisión dental.",
  },
};
