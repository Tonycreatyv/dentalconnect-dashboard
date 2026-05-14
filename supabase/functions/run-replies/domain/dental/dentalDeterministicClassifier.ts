import { normalizeText } from "../normalization.ts";
import {
  EMPTY_DENTAL_INTERPRETER_RESULT,
  type DentalClinicalCategory,
  type DentalInterpreterResult,
} from "../interpreter/dentalInterpreterTypes.ts";
import { DENTAL_STANDARD_CATEGORIES } from "./dentalStandardKnowledge.ts";

function normalizeInput(input: string): string {
  return normalizeText(input)
    .toLowerCase()
    .replace(/([a-z])\1{2,}/g, "$1")
    .replace(/\bteengo\b/g, "tengo")
    .replace(/\bqie\b/g, "que")
    .replace(/\bq\b/g, "que")
    .replace(/\bk\b/g, "que")
    .replace(/\bke\b/g, "que")
    .replace(/\bdkas\b/g, "dias")
    .replace(/\borarios\b/g, "horarios")
    .replace(/\bsita\b/g, "cita")
    .replace(/\bmanan?a\b/g, "manana")
    .replace(/\s+/g, " ")
    .trim();
}

function detectDateTime(normalized: string): { date: string | null; time: string | null } {
  const hasTomorrow = /\bmanana\b/.test(normalized);
  const hasToday = /\bhoy\b/.test(normalized);
  const timeMatch = normalized.match(/\ba\s+las\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let time: string | null = null;
  if (timeMatch) {
    let h = Number(timeMatch[1]);
    const m = Number(timeMatch[2] ?? "0");
    const mer = (timeMatch[3] ?? "").toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  const now = new Date();
  const dateObj = hasTomorrow
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    : hasToday
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : null;

  const date = dateObj
    ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${
      String(dateObj.getDate()).padStart(2, "0")
    }`
    : null;

  return { date, time };
}

const CATEGORY_INTENT: Partial<Record<DentalClinicalCategory, DentalInterpreterResult["intent"]>> = {
  pricing: "ask_price",
  business_hours: "ask_business_hours",
  location: "ask_location",
  appointment_lookup: "appointment_lookup",
  reschedule: "reschedule_appointment",
  cancel: "cancel_appointment",
};

export function classifyDentalDeterministic(text: string): DentalInterpreterResult {
  const normalized = normalizeInput(text);
  if (!normalized) return { ...EMPTY_DENTAL_INTERPRETER_RESULT };

  if (/\b(hola|buenas|buen dia|buenas tardes|hello)\b/.test(normalized)) {
    return {
      ...EMPTY_DENTAL_INTERPRETER_RESULT,
      intent: "greeting",
      confidence: 0.9,
      source: "deterministic",
    };
  }

  if (/\b(que cita tengo|a que hora es mi cita|confirmame mi cita|cuando tengo cita|tengo cita)\b/.test(normalized)) {
    return {
      ...EMPTY_DENTAL_INTERPRETER_RESULT,
      intent: "appointment_lookup",
      clinical_category: "appointment_lookup",
      confidence: 0.88,
      source: "deterministic",
    };
  }

  if (/\b(reagendar|reagenda|cambiar mi cita|mover mi cita)\b/.test(normalized)) {
    return {
      ...EMPTY_DENTAL_INTERPRETER_RESULT,
      intent: "reschedule_appointment",
      clinical_category: "reschedule",
      confidence: 0.88,
      source: "deterministic",
    };
  }

  if (/\b(cancelar cita|cancelar mi cita|cancelar|anular cita)\b/.test(normalized)) {
    return {
      ...EMPTY_DENTAL_INTERPRETER_RESULT,
      intent: "cancel_appointment",
      clinical_category: "cancel",
      confidence: 0.88,
      source: "deterministic",
    };
  }

  if (/\b(cuanto|cuanto vale|precio|costo|cuesta)\b/.test(normalized)) {
    return {
      ...EMPTY_DENTAL_INTERPRETER_RESULT,
      intent: "ask_price",
      clinical_category: "pricing",
      confidence: 0.78,
      source: "deterministic",
    };
  }

  for (const [categoryKey, cfg] of Object.entries(DENTAL_STANDARD_CATEGORIES)) {
    if (!cfg) continue;
    const hits = cfg.examples.filter((ex) => normalized.includes(ex));
    if (!hits.length) continue;

    const category = categoryKey as DentalClinicalCategory;
    const { date, time } = detectDateTime(normalized);
    const urgentSignals = cfg.urgent_signals ?? [];
    const urgency = urgentSignals.some((s) => normalized.includes(s)) ? "urgent" : cfg.default_urgency;
    const baseConfidence = ["cleaning", "orthodontics", "whitening"].includes(category) ? 0.85 : 0.8;

    return {
      ...EMPTY_DENTAL_INTERPRETER_RESULT,
      intent: CATEGORY_INTENT[category] ?? "book_appointment",
      clinical_category: category,
      service_suggestion: cfg.service_suggestion,
      urgency,
      symptoms: hits,
      safe_reply_hint: cfg.safe_reply_hint,
      date,
      time,
      missing_slots: [
        ...(cfg.service_suggestion ? [] : (["service"] as const)),
        ...(date ? [] : (["date"] as const)),
        ...(time ? [] : (["time"] as const)),
      ],
      confidence: baseConfidence,
      source: "deterministic",
    };
  }

  if (/\b(que horarios|disponibilidad|ver horarios|espacios)\b/.test(normalized)) {
    return {
      ...EMPTY_DENTAL_INTERPRETER_RESULT,
      intent: "ask_availability",
      confidence: 0.74,
      source: "deterministic",
    };
  }

  return { ...EMPTY_DENTAL_INTERPRETER_RESULT };
}
