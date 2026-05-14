import {
  DENTAL_SERVICES_CATALOG,
  getDentalServiceById,
  type DentalServiceDefinition,
} from "./servicesCatalog.ts";

export type EvaluationContext = {
  evaluationPrice: number;
  evaluationDurationMinutes: number;
  evaluationName?: string;
  currency?: string;
};

export type VariablePriceArgs = EvaluationContext & {
  serviceId: string;
  serviceName?: string;
};

export type FixedPriceArgs = {
  serviceName: string;
  currency?: string;
  exactPrice?: number;
  fromPrice?: number;
  isFrom?: boolean;
};

const DEFAULT_CURRENCY = "HNL";
const DEFAULT_EVALUATION_NAME = "evaluación";

export function normalizeDentalText(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function findDentalServiceByText(text: string): DentalServiceDefinition | null {
  const normalized = normalizeDentalText(text);
  if (!normalized) return null;

  let bestMatch: DentalServiceDefinition | null = null;
  let bestScore = 0;

  for (const service of DENTAL_SERVICES_CATALOG) {
    const allTokens = [service.name, ...service.aliases].map(normalizeDentalText);
    for (const token of allTokens) {
      if (!token) continue;
      if (normalized.includes(token)) {
        const score = token.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = service;
        }
      }
    }
  }

  return bestMatch;
}

export function isVariablePriceService(serviceId: string): boolean {
  const service = getDentalServiceById(serviceId);
  return service?.priceType === "variable";
}

export function getVariablePriceReason(serviceId: string): string {
  const service = getDentalServiceById(serviceId);
  return service?.variablePriceReason || "depende de la evaluación clínica del caso.";
}

export function buildEvaluationPriceResponse(args: EvaluationContext): string {
  const currency = args.currency || DEFAULT_CURRENCY;
  const evaluationName = args.evaluationName || DEFAULT_EVALUATION_NAME;
  return `La ${evaluationName} cuesta ${currency} ${args.evaluationPrice} y dura aproximadamente ${args.evaluationDurationMinutes} minutos. En esa cita el doctor revisa tu caso y te indica el plan o costo exacto.`;
}

export function buildVariablePriceResponse(args: VariablePriceArgs): string {
  const service = getDentalServiceById(args.serviceId);
  const serviceName = args.serviceName || service?.name || "el tratamiento";
  const reasonRaw = getVariablePriceReason(args.serviceId).trim();
  const reason = reasonRaw.replace(/\.$/, "");
  const connector = /^depende\b/i.test(reason) ? ":" : ", porque";
  return `El precio de ${serviceName.toLowerCase()} depende del caso${connector} ${reason}. La evaluación cuesta ${args.currency || DEFAULT_CURRENCY} ${args.evaluationPrice} y dura aproximadamente ${args.evaluationDurationMinutes} minutos. Ahí te dan el costo exacto.`;
}

export function buildFixedPriceResponse(args: FixedPriceArgs): string {
  const currency = args.currency || DEFAULT_CURRENCY;
  if (typeof args.exactPrice === "number") {
    return `${args.serviceName} cuesta ${currency} ${args.exactPrice}. ¿Querés que revisemos horarios disponibles?`;
  }
  if (typeof args.fromPrice === "number") {
    if (args.isFrom) {
      return `${args.serviceName} inicia desde ${currency} ${args.fromPrice}. ¿Querés que revisemos horarios disponibles?`;
    }
    return `${args.serviceName} cuesta desde ${currency} ${args.fromPrice}. ¿Querés que revisemos horarios disponibles?`;
  }
  return `Para ${args.serviceName.toLowerCase()}, primero te recomiendo evaluación para darte un costo exacto.`;
}
