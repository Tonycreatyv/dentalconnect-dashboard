type Json = Record<string, unknown>;

function safeStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

export function normalizeLeadStateForBusinessType(
  leadState: Json | null,
  businessType: string,
): Json {
  const base = leadState && typeof leadState === "object" ? { ...leadState } as Record<string, unknown> : {};
  const normalized = safeStr(businessType, "").toLowerCase();
  if (normalized !== "barbershop") return base as Json;

  const contaminatedDentalMode = safeStr(base.mode, "").toLowerCase() === "dental_clinic";
  const collected = base.collected && typeof base.collected === "object"
    ? { ...(base.collected as Record<string, unknown>) }
    : {};
  const normalizeToken = (input: unknown) =>
    safeStr(input, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const anyAliases = [
    "cualquiera",
    "cualqueira",
    "cualqiera",
    "cualquier",
    "el que este libre",
    "quien este libre",
  ];
  const isAnyAlias = (value: unknown) => {
    const token = normalizeToken(value);
    return token.length > 0 && anyAliases.some((alias) => token === alias || token.includes(alias));
  };
  const preferredBarber = safeStr(collected.preferred_barber, "").trim();
  const providerName = safeStr(collected.provider_name, "").trim();
  const providerPreference = normalizeToken(collected.provider_preference);
  if (
    providerPreference === "any" ||
    isAnyAlias(preferredBarber) ||
    isAnyAlias(providerName)
  ) {
    collected.preferred_barber = null;
    collected.provider_name = null;
    collected.provider_preference = "any";
  }

  if (contaminatedDentalMode) {
    delete (base as Record<string, unknown>).asked;
    delete (base as Record<string, unknown>).availability;
    delete (base as Record<string, unknown>).intent;
    delete (base as Record<string, unknown>).slots;
    delete (base as Record<string, unknown>).last_bot_question;
    delete (base as Record<string, unknown>).last_bot_question_key;
    delete (base as Record<string, unknown>).last_bot_question_repeat_count;
  }

  return {
    ...base,
    mode: "barbershop",
    orgType: "barbershop",
    stage: contaminatedDentalMode ? "DISCOVERY" : (safeStr(base.stage, "DISCOVERY") || "DISCOVERY"),
    phase: contaminatedDentalMode ? "new" : (safeStr(base.phase, "new") || "new"),
    nextExpected: contaminatedDentalMode ? null : (base.nextExpected ?? null) as Json,
    lastIntent: contaminatedDentalMode ? null : (base.lastIntent ?? null) as Json,
    collected,
  } as Json;
}
