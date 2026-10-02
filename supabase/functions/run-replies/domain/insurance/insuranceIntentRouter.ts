import {
  type InsuranceServiceOption,
  resolveInsuranceServiceOption,
} from "./insuranceResponseComposer.ts";

export type InsuranceTurnIntent =
  | "greeting"
  | "insurance_type"
  | "contact_details"
  | "current_insurance_answer"
  | "budget"
  | "preferred_time"
  | "confirm"
  | "restart"
  | "unknown";

function normalizeText(input: string): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyInsuranceIntent(args: {
  text: string;
  nextExpected?: string | null;
  services?: InsuranceServiceOption[];
}): InsuranceTurnIntent {
  const text = normalizeText(args.text).replace(/^action:/, "");
  const nextExpected = String(args.nextExpected ?? "").trim();
  if (/\b(empezar de nuevo|reiniciar|reset)\b/.test(text)) return "restart";
  if (/^(hola|buenas|hey|hi|hello)\b/.test(text)) return "greeting";
  if (/^(si|s[ií]|ok|confirmo|correcto|dale|claro|listo)$/.test(text)) return "confirm";

  if (/^insurance_type:/.test(text)) return "insurance_type";
  if (/^insurance_current:/.test(text)) return "current_insurance_answer";
  if (/^insurance_budget:/.test(text)) return "budget";
  if (/^insurance_time:/.test(text)) return "preferred_time";

  if (nextExpected === "insurance_type") return "insurance_type";
  if (nextExpected === "insurance_name") return "contact_details";
  if (nextExpected === "insurance_location") return "contact_details";
  if (nextExpected === "insurance_email") return "contact_details";
  if (nextExpected === "insurance_current") return "current_insurance_answer";
  if (nextExpected === "insurance_budget") return "budget";
  if (nextExpected === "insurance_preferred_time") return "preferred_time";

  if (resolveInsuranceServiceOption(text, args.services ?? [])) return "insurance_type";
  if (/\b(seguro|aseguranza|poliza|p[oó]liza|cotizar|cotizacion|cotizaci[oó]n)\b/.test(text)) {
    return "insurance_type";
  }
  if (/@/.test(text) || /\b\d{7,}\b/.test(text)) return "contact_details";
  if (/\b(tengo|no tengo|actualmente|ya tengo)\b/.test(text)) return "current_insurance_answer";
  if (/\b(presupuesto|mensual|\$|dolares|d[oó]lares|\d+\s*(usd|dolares|d[oó]lares)?)\b/.test(text)) {
    return "budget";
  }
  if (/\b(ma[nñ]ana|tarde|noche|mediodia|medio dia|despu[eé]s|antes)\b/.test(text)) return "preferred_time";
  return "unknown";
}
