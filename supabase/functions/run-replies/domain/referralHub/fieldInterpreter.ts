export type FieldConfidence = "high" | "medium" | "low";

export type FieldInterpretation = {
  rawValue: string;
  normalizedValue: string | null;
  confidence: FieldConfidence;
  needsConfirmation: boolean;
  clarificationPrompt?: string;
  metadata?: Record<string, unknown>;
};

export type StructuredFieldInterpreter = (
  field: string,
  rawValue: string,
) => Promise<FieldInterpretation | null>;

function compact(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function token(value: unknown) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim();
}

function titleCase(value: string) {
  return value.toLocaleLowerCase("es-US").replace(
    /(^|[\s-])(\p{L})/gu,
    (_, separator: string, letter: string) => `${separator}${letter.toLocaleUpperCase("es-US")}`,
  );
}

const CITY_CORRECTIONS: Record<string, { city: string; region?: string }> = {
  altnata: { city: "Atlanta", region: "Georgia" },
  atlnta: { city: "Atlanta", region: "Georgia" },
  atlanda: { city: "Atlanta", region: "Georgia" },
  atlanta: { city: "Atlanta", region: "Georgia" },
  marieta: { city: "Marietta", region: "Georgia" },
  marietta: { city: "Marietta", region: "Georgia" },
  miami: { city: "Miami", region: "Florida" },
};

export async function interpretCity(
  rawInput: string,
  fallback?: StructuredFieldInterpreter,
): Promise<FieldInterpretation> {
  const rawValue = compact(rawInput);
  const normalizedToken = token(rawValue);
  if (normalizedToken.length < 2 || !/\p{L}/u.test(normalizedToken)) {
    return {
      rawValue,
      normalizedValue: null,
      confidence: "low",
      needsConfirmation: false,
      clarificationPrompt: "No pude identificar la ciudad. ¿Puedes escribirla nuevamente?",
    };
  }

  const known = CITY_CORRECTIONS[normalizedToken];
  if (known) {
    const onlyFormattingChanged = token(known.city) === normalizedToken;
    return {
      rawValue,
      normalizedValue: known.city,
      confidence: "high",
      needsConfirmation: !onlyFormattingChanged,
      clarificationPrompt: !onlyFormattingChanged
        ? `¿Te refieres a ${known.city}${known.region ? `, ${known.region}` : ""}?`
        : undefined,
      metadata: { region: known.region ?? null, source: onlyFormattingChanged ? "normalized_exact" : "deterministic_correction" },
    };
  }

  if (fallback) {
    const interpreted = await fallback("city", rawValue);
    if (interpreted?.normalizedValue) return interpreted;
  }

  const words = normalizedToken.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && words.every((word) => word.length >= 2)) {
    return {
      rawValue,
      normalizedValue: titleCase(normalizedToken),
      confidence: "medium",
      needsConfirmation: false,
      metadata: { region: null, source: "deterministic_formatting" },
    };
  }

  return {
    rawValue,
    normalizedValue: null,
    confidence: "low",
    needsConfirmation: false,
    clarificationPrompt: "No pude identificar la ciudad. ¿Puedes escribirla nuevamente?",
  };
}

function datePartsInTimezone(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

function isoFromLocalOffset(now: Date, timezone: string, offsetDays: number) {
  const local = datePartsInTimezone(now, timezone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + offsetDays, 12));
  return date.toISOString().slice(0, 10);
}

export function interpretAccidentDate(
  rawInput: string,
  timezone = "America/New_York",
  now = new Date(),
): FieldInterpretation {
  const rawValue = compact(rawInput);
  const normalized = token(rawValue);
  const exactOffset: Record<string, number> = {
    hoy: 0,
    ayer: -1,
    antier: -2,
    "ante ayer": -2,
    "hace dos dias": -2,
  };
  if (normalized in exactOffset) {
    return {
      rawValue,
      normalizedValue: isoFromLocalOffset(now, timezone, exactOffset[normalized]),
      confidence: "high",
      needsConfirmation: false,
      metadata: { timezone, source: "relative_date" },
    };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = new Date(`${normalized}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return { rawValue, normalizedValue: normalized, confidence: "high", needsConfirmation: false, metadata: { timezone, source: "iso_date" } };
    }
  }
  const weekdays: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
  const weekday = Object.entries(weekdays).find(([name]) => normalized === name || normalized === `el ${name}`);
  if (weekday) {
    const today = new Date(`${isoFromLocalOffset(now, timezone, 0)}T12:00:00Z`);
    const target = weekday[1];
    const daysBack = (today.getUTCDay() - target + 7) % 7 || 7;
    const candidate = isoFromLocalOffset(now, timezone, -daysBack);
    const label = new Intl.DateTimeFormat("es-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${candidate}T12:00:00Z`));
    return {
      rawValue,
      normalizedValue: candidate,
      confidence: "medium",
      needsConfirmation: true,
      clarificationPrompt: `¿Te refieres al ${label}?`,
      metadata: { timezone, source: "weekday_relative" },
    };
  }
  if (normalized === "la semana pasada") {
    return {
      rawValue,
      normalizedValue: null,
      confidence: "low",
      needsConfirmation: false,
      clarificationPrompt: "¿Qué día de la semana pasada ocurrió?",
      metadata: { timezone, source: "ambiguous_relative_date" },
    };
  }
  return {
    rawValue,
    normalizedValue: null,
    confidence: "low",
    needsConfirmation: false,
    clarificationPrompt: "No pude identificar la fecha. Escríbela como mes, día y año.",
    metadata: { timezone, source: "unrecognized" },
  };
}
