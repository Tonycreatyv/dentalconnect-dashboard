import type { BarbershopService, DetectedBarbershopRequest } from "./scenarioTypes.ts";

export const BARBERSHOP_SERVICES_CATALOG: BarbershopService[] = [
  {
    id: "haircut",
    name: "Corte clásico",
    aliases: ["corte", "corte de cabello", "haircut"],
    durationMinutes: 30,
    priceType: "fixed",
    basePriceHnl: 150,
  },
  {
    id: "beard",
    name: "Barba",
    aliases: ["barba", "arreglo de barba"],
    durationMinutes: 20,
    priceType: "fixed",
    basePriceHnl: 100,
  },
  {
    id: "haircut_beard",
    name: "Corte + barba",
    aliases: ["corte y barba", "corte + barba", "combo corte barba", "corte con barba"],
    durationMinutes: 45,
    priceType: "fixed",
    basePriceHnl: 220,
  },
  {
    id: "eyebrows",
    name: "Cejas",
    aliases: ["cejas", "perfilado de cejas"],
    durationMinutes: 15,
    priceType: "fixed",
    basePriceHnl: 60,
  },
  {
    id: "kids_haircut",
    name: "Corte niño",
    aliases: ["corte niño", "corte nino", "corte para niño", "corte para nino"],
    durationMinutes: 30,
    priceType: "fixed",
    basePriceHnl: 130,
  },
];

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/c\\y/g, "c y")
    .replace(/\bcy\b/g, "c y")
    .replace(/\bc\s*y\b/g, "y")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s*\+\s*/g, " + ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPreferredBarber(input: string): string | null {
  const normalized = normalizeText(input);
  const rawCandidate =
    normalized.match(/\b(?:con|quiero con|me atiende)\s+([a-z]+)\b/i)?.[1] ??
    null;
  if (!rawCandidate) return null;
  const raw = rawCandidate.trim().toLowerCase();
  const blacklisted = new Set([
    "corte",
    "barba",
    "cejas",
    "cabello",
    "pelo",
    "recorte",
    "combo",
    "servicio",
    "cita",
    "barberia",
    "barbero",
    "barberos",
    "clasico",
    "normal",
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
  ]);
  if (!raw || raw.length < 3 || blacklisted.has(raw)) return null;
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
}

export function detectBarbershopService(input: string): DetectedBarbershopRequest {
  const normalized = normalizeText(input);
  const preferredBarber = detectPreferredBarber(input);

  const hasHaircut = /\b(corte|cote|core)\b|haircut|cortarme el pelo|corte de cabello|core de pelo/.test(normalized);
  const hasBeard = /\bbarba\b/.test(normalized);
  const hasEyebrows = /\bcejas\b/.test(normalized);
  const hasKids = /\bnino\b/.test(normalized);
  const hasComboSignal = /\b(corte y barba|corte con barba|corte \+ barba|corte \/ barba|combo|combo completo|cote y barba|core y barba)\b/.test(
    normalized,
  );

  if (hasComboSignal || (hasHaircut && hasBeard)) {
    const matchedService = BARBERSHOP_SERVICES_CATALOG.find((s) => s.id === "haircut_beard") ?? null;
    return { matchedService, preferredBarber, confidence: 0.95 };
  }

  if (hasKids && hasHaircut) {
    const matchedService = BARBERSHOP_SERVICES_CATALOG.find((s) => s.id === "kids_haircut") ?? null;
    return { matchedService, preferredBarber, confidence: 0.9 };
  }

  if (hasEyebrows) {
    const matchedService = BARBERSHOP_SERVICES_CATALOG.find((s) => s.id === "eyebrows") ?? null;
    return { matchedService, preferredBarber, confidence: 0.9 };
  }

  if (hasBeard) {
    const matchedService = BARBERSHOP_SERVICES_CATALOG.find((s) => s.id === "beard") ?? null;
    return { matchedService, preferredBarber, confidence: 0.9 };
  }

  if (hasHaircut) {
    const matchedService = BARBERSHOP_SERVICES_CATALOG.find((s) => s.id === "haircut") ?? null;
    return { matchedService, preferredBarber, confidence: 0.9 };
  }

  for (const service of BARBERSHOP_SERVICES_CATALOG) {
    if (service.aliases.some((alias) => normalized.includes(normalizeText(alias)))) {
      return { matchedService: service, preferredBarber, confidence: 0.85 };
    }
  }

  return {
    matchedService: null,
    preferredBarber,
    confidence: 0,
  };
}

export function getBarbershopServiceById(serviceId: string): BarbershopService | null {
  return BARBERSHOP_SERVICES_CATALOG.find((s) => s.id === serviceId) ?? null;
}
