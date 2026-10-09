type JsonRecord = Record<string, unknown>;

export type BarberLinePersonalityTone = "energetic_funny" | "neutral";

export interface BarberLinePersonalitySettings {
  enabled?: boolean;
  tone?: BarberLinePersonalityTone;
  humor_level?: "none" | "light" | "medium";
  local_style?: "honduras_latam" | "neutral";
  emoji_level?: "none" | "low" | "medium";
}

export interface BarberLineReplyContext {
  businessType?: string | null;
  channel?: string | null;
  inboundText?: string | null;
  statePatch?: JsonRecord | null;
  debugNote?: string | null;
  bookingSuccessAuthorized?: boolean;
}

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function normalize(input: unknown): string {
  return safeStr(input, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBarberLinePersonalitySettings(
  raw?: BarberLinePersonalitySettings | JsonRecord | null,
): Required<BarberLinePersonalitySettings> {
  const settings = (raw ?? {}) as JsonRecord;
  return {
    enabled: settings.enabled === false ? false : true,
    tone: settings.tone === "neutral" ? "neutral" : "energetic_funny",
    humor_level: settings.humor_level === "none" || settings.humor_level === "medium" ? settings.humor_level : "light",
    local_style: settings.local_style === "neutral" ? "neutral" : "honduras_latam",
    emoji_level: settings.emoji_level === "none" || settings.emoji_level === "low" ? settings.emoji_level : "medium",
  };
}

function isBarbershopWhatsApp(context: BarberLineReplyContext): boolean {
  return normalize(context.businessType) === "barbershop" && normalize(context.channel) === "whatsapp";
}

function isUnsafeForHumor(baseResponse: string): boolean {
  const t = normalize(baseResponse);
  return /\b(error|problema|fall[oa]|no pude|no puedo|recepcion|operador|humano|soporte|pago|factura|cobro|tarjeta|reembolso|queja|molestia)\b/.test(t);
}

function isCasualFunnyInbound(inboundText: string): boolean {
  const t = normalize(inboundText);
  return /\b(jaja|haha|jeje|mu[nn]eco|chucky|feo|horrible|rescatame|rescate|quedar nitido|quedar fresh)\b/.test(t) || /[😂😭😅😎]/.test(inboundText);
}

function personalityEnabled(settings?: BarberLinePersonalitySettings | JsonRecord | null): boolean {
  const normalized = normalizeBarberLinePersonalitySettings(settings);
  return normalized.enabled && normalized.tone !== "neutral" && normalized.humor_level !== "none";
}

export function formatBarberLineReply(
  baseResponse: string,
  context: BarberLineReplyContext = {},
  personalitySettings?: BarberLinePersonalitySettings | JsonRecord | null,
): string {
  if (!baseResponse || !isBarbershopWhatsApp(context) || !personalityEnabled(personalitySettings)) {
    return baseResponse;
  }
  if (isUnsafeForHumor(baseResponse)) return baseResponse;

  return baseResponse;
}
