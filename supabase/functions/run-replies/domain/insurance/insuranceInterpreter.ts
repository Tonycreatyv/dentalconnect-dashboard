import { classifyInsuranceIntent, type InsuranceTurnIntent } from "./insuranceIntentRouter.ts";
import {
  findInsuranceFaqMatch,
  type InsuranceFaqEntry,
} from "./insuranceKnowledgeBase.ts";
import {
  type InsuranceServiceOption,
  resolveInsuranceServiceOption,
} from "./insuranceResponseComposer.ts";

export type InsuranceCurrentCoverageStatus = "vence_pronto" | "comparando" | "no_tiene";

export type InsuranceCollected = {
  tipo_seguro?: string;
  tipo_seguro_id?: string;
  contacto?: {
    nombre?: string;
    estado?: string;
    telefono?: string;
    email?: string;
  };
  seguro_actual?: InsuranceCurrentCoverageStatus;
  presupuesto?: string;
  horario_preferido?: string;
  notes?: Array<{ pregunta: string; timestamp: string }>;
  scoring?: {
    prioridad: "alta" | "media" | "baja";
    score: number;
    razones: string[];
  };
  saved?: boolean;
};

export type InsuranceInterpretedTurn = {
  intent: InsuranceTurnIntent;
  fields_found: {
    tipo_seguro: string | null;
    tipo_seguro_id: string | null;
    nombre: string | null;
    estado: string | null;
    telefono: string | null;
    email: string | null;
    seguro_actual: InsuranceCurrentCoverageStatus | null;
    presupuesto: string | null;
    horario_preferido: string | null;
  };
  missing_fields: string[];
  faq_match: InsuranceFaqEntry | null;
  invalid_expected_answer: boolean;
  next_step:
    | "ask_insurance_type"
    | "ask_name"
    | "ask_location"
    | "ask_email"
    | "ask_current_insurance"
    | "ask_budget"
    | "ask_preferred_time"
    | "save_lead"
    | "confirm"
    | "clarify";
  confidence: number;
};

function safeStr(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeText(input: string): string {
  return safeStr(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmail(text: string): string | null {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function extractName(text: string): string | null {
  const direct = text.match(/\b(?:me llamo|soy|mi nombre es)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+){0,3})/i);
  if (direct) {
    return direct[1].replace(/\s+(?:de|en|mi|tel[eé]fono|telefono|email|correo).*$/i, "").trim();
  }
  const trimmed = safeStr(text).replace(/\s+/g, " ");
  if (!trimmed || extractEmail(trimmed) || /\d{4,}/.test(trimmed)) return null;
  return trimmed.slice(0, 80);
}

function extractState(text: string): string | null {
  const direct = text.match(/\b(?:estado|vivo en|estoy en|soy de)\s+([a-záéíóúñü ]{2,30})/i);
  if (direct) return direct[1].replace(/\s+(?:mi|tel[eé]fono|telefono|email|correo).*$/i, "").trim();
  const trimmed = safeStr(text).replace(/\s+/g, " ");
  if (!trimmed || extractEmail(trimmed)) return null;
  return trimmed.slice(0, 80);
}

function extractBudget(text: string): string | null {
  const action = normalizeActionId(text);
  if (action === "insurance_budget:under_50") return "40";
  if (action === "insurance_budget:50_100") return "75";
  if (action === "insurance_budget:100_200_plus") return "150";
  const explicit = text.match(/(?:\$|usd\s*)?\d+(?:[.,]\d{2})?\s*(?:usd|d[oó]lares)?/i);
  if (explicit) return explicit[0].trim();
  if (/\b(no se|no estoy seguro|depende|flexible)\b/i.test(text)) return "flexible";
  return null;
}

function extractCurrentInsurance(text: string): InsuranceCurrentCoverageStatus | null {
  const action = normalizeActionId(text);
  if (action === "insurance_current:vence_pronto") return "vence_pronto";
  if (action === "insurance_current:comparando") return "comparando";
  if (action === "insurance_current:no_tiene") return "no_tiene";
  if (action === "insurance_current:yes") return "comparando";
  if (action === "insurance_current:no") return "no_tiene";
  const normalized = normalizeText(text);
  if (/\b(vence pronto|se vence|por vencer|renovar|renovacion|expira|caduca|vence)\b/.test(normalized)) return "vence_pronto";
  if (/\b(no tengo|sin seguro|no)\b/.test(normalized)) return "no_tiene";
  if (/\b(compar|cotiz|mejor precio|ya tengo|actualmente tengo|tengo|si tengo|s[ií])\b/.test(normalized)) return "comparando";
  return null;
}

function extractPreferredTime(text: string): string | null {
  const action = normalizeActionId(text);
  if (action === "insurance_time:early") return "Temprano (8am-12pm)";
  if (action === "insurance_time:afternoon") return "Tarde (12pm-5pm)";
  if (action === "insurance_time:any") return "Cuando pueda";
  const trimmed = safeStr(text);
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

function normalizeActionId(text: string): string {
  return normalizeText(text)
    .replace(/^action:/, "")
    .replace(/\s+/g, "_");
}

function missingContactFields(contact: InsuranceCollected["contacto"]): string[] {
  const missing: string[] = [];
  if (!safeStr(contact?.nombre)) missing.push("nombre");
  if (!safeStr(contact?.estado)) missing.push("estado");
  if (!safeStr(contact?.email)) missing.push("email");
  return missing;
}

export function calculateInsuranceScoring(collected: InsuranceCollected): NonNullable<InsuranceCollected["scoring"]> {
  let score = 25;
  const razones: string[] = [];
  if (collected.tipo_seguro) {
    score += 15;
    razones.push("tipo de seguro definido");
  }
  if (collected.seguro_actual === "vence_pronto") {
    score += 30;
    razones.push("seguro actual vence pronto");
  } else if (collected.seguro_actual === "comparando") {
    score += 15;
    razones.push("compara cobertura existente");
  } else if (collected.seguro_actual === "no_tiene") {
    score += 20;
    razones.push("no tiene cobertura actual");
  }
  const budgetNumber = Number(safeStr(collected.presupuesto).replace(/[^\d.]/g, ""));
  if (Number.isFinite(budgetNumber) && budgetNumber > 0) {
    score += budgetNumber >= 100 ? 20 : 10;
    razones.push("presupuesto informado");
  }
  if (collected.horario_preferido) {
    score += 10;
    razones.push("horario de contacto definido");
  }
  const bounded = Math.max(0, Math.min(100, score));
  return {
    prioridad: bounded >= 70 ? "alta" : bounded >= 45 ? "media" : "baja",
    score: bounded,
    razones,
  };
}

export function interpretInsuranceTurn(args: {
  inboundText: string;
  nextExpected?: string | null;
  services: InsuranceServiceOption[];
  collected?: InsuranceCollected | null;
}): InsuranceInterpretedTurn {
  const nextExpected = safeStr(args.nextExpected);
  const existing = args.collected ?? {};
  const existingContact = existing.contacto ?? {};
  const faqMatch = findInsuranceFaqMatch({
    text: args.inboundText,
    tipoSeguroId: existing.tipo_seguro_id ?? null,
  });
  const shouldParseType = nextExpected === "insurance_type" ||
    (!nextExpected && !safeStr(args.collected?.tipo_seguro));
  const selectedService = shouldParseType
    ? faqMatch ? null : resolveInsuranceServiceOption(args.inboundText, args.services)
    : null;
  const fields = {
    tipo_seguro: shouldParseType ? selectedService?.name ?? null : null,
    tipo_seguro_id: shouldParseType ? selectedService?.id ?? null : null,
    nombre: nextExpected === "insurance_name" && !faqMatch ? extractName(args.inboundText) : null,
    estado: nextExpected === "insurance_location" && !faqMatch ? extractState(args.inboundText) : null,
    telefono: null,
    email: nextExpected === "insurance_email" && !faqMatch ? extractEmail(args.inboundText) : null,
    seguro_actual: nextExpected === "insurance_current" && !faqMatch ? extractCurrentInsurance(args.inboundText) : null,
    presupuesto: nextExpected === "insurance_budget" && !faqMatch ? extractBudget(args.inboundText) : null,
    horario_preferido: nextExpected === "insurance_preferred_time" && !faqMatch ? extractPreferredTime(args.inboundText) : null,
  };
  const mergedContact = {
    nombre: fields.nombre ?? existingContact.nombre,
    estado: fields.estado ?? existingContact.estado,
    telefono: fields.telefono ?? existingContact.telefono,
    email: fields.email ?? existingContact.email,
  };
  const missing: string[] = [];
  if (!(selectedService?.name ?? existing.tipo_seguro)) missing.push("tipo_seguro");
  missing.push(...missingContactFields(mergedContact));
  if (!(fields.seguro_actual ?? existing.seguro_actual)) missing.push("seguro_actual");
  if (!(fields.presupuesto ?? existing.presupuesto)) missing.push("presupuesto");
  if (!(fields.horario_preferido ?? existing.horario_preferido)) missing.push("horario_preferido");

  const intent = classifyInsuranceIntent({
    text: args.inboundText,
    nextExpected: args.nextExpected,
    services: args.services,
  });
  const nextStep: InsuranceInterpretedTurn["next_step"] =
    missing.includes("tipo_seguro") ? "ask_insurance_type"
      : missing.includes("nombre") ? "ask_name"
      : missing.includes("estado") ? "ask_location"
      : missing.includes("email") ? "ask_email"
      : missing.includes("seguro_actual") ? "ask_current_insurance"
      : missing.includes("presupuesto") ? "ask_budget"
      : missing.includes("horario_preferido") ? "ask_preferred_time"
      : "save_lead";
  const expectedFieldValid = nextExpected === "insurance_type" ? Boolean(fields.tipo_seguro)
    : nextExpected === "insurance_name" ? Boolean(fields.nombre)
    : nextExpected === "insurance_location" ? Boolean(fields.estado)
    : nextExpected === "insurance_email" ? Boolean(fields.email)
    : nextExpected === "insurance_current" ? Boolean(fields.seguro_actual)
    : nextExpected === "insurance_budget" ? Boolean(fields.presupuesto)
    : nextExpected === "insurance_preferred_time" ? Boolean(fields.horario_preferido)
    : true;

  return {
    intent,
    fields_found: fields,
    missing_fields: missing,
    faq_match: faqMatch,
    invalid_expected_answer: Boolean(nextExpected) && !faqMatch && !expectedFieldValid,
    next_step: nextStep,
    confidence: intent === "unknown" ? 0.35 : 0.82,
  };
}
