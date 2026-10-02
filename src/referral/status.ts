import type { ReferralLead, ReferralService, ReferralStatus } from "./types";

export const REFERRAL_STATUSES: Array<{ value: ReferralStatus; label: string }> = [
  { value: "new", label: "Nuevo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Calificado" },
  { value: "sent_to_partner", label: "Enviado al aliado" },
  { value: "closed", label: "Cerrado" },
  { value: "not_qualified", label: "No califica" },
];

export const statusTone: Record<ReferralStatus, "accent" | "warning" | "success" | "muted" | "danger"> = {
  new: "accent",
  contacted: "warning",
  qualified: "success",
  sent_to_partner: "success",
  closed: "muted",
  not_qualified: "danger",
};

export function normalizeReferralStatus(value: unknown): ReferralStatus {
  const raw = String(value ?? "").trim();
  return REFERRAL_STATUSES.some((item) => item.value === raw) ? raw as ReferralStatus : "new";
}

export function statusLabel(value: unknown): string {
  const status = normalizeReferralStatus(value);
  return REFERRAL_STATUSES.find((item) => item.value === status)?.label ?? "Nuevo";
}

export function leadName(lead: ReferralLead): string {
  const data = lead.extracted_data ?? {};
  return String(lead.full_name ?? lead.name ?? lead.first_name ?? data.nombre ?? data.name ?? lead.channel_user_id ?? "Lead sin nombre").trim();
}

export function leadPhone(lead: ReferralLead): string {
  const data = lead.extracted_data ?? {};
  return String(lead.phone ?? data.telefono ?? data.phone ?? lead.channel_user_id ?? "").trim();
}

export function serviceName(service?: ReferralService): string {
  return String(service?.menu_label ?? service?.nombre ?? "Servicio").trim();
}

export function publicPartnerName(value?: string | null): string {
  return String(value ?? "").replace(/^\s*\[EJEMPLO\]\s*/i, "").trim();
}

export function relativeAge(value?: string | null): string {
  if (!value) return "Sin fecha";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Sin fecha";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return `Hace ${Math.floor(hours / 24)} d`;
}

export function extractedText(lead: ReferralLead, keys: string[]): string {
  const data = lead.extracted_data ?? {};
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function leadUrgency(lead: ReferralLead): string {
  return extractedText(lead, ["prioridad", "priority", "urgencia", "urgency"]);
}

export function leadLocation(lead: ReferralLead): string {
  const city = extractedText(lead, ["ciudad", "city"]);
  const state = extractedText(lead, ["estado", "state", "provincia"]);
  return [city, state].filter(Boolean).join(", ");
}

export function leadSource(lead: ReferralLead): string {
  return extractedText(lead, ["source", "fuente", "campaign", "campana", "campaña", "flyer"]);
}

export function isUrgent(lead: ReferralLead): boolean {
  return /alta|high|urgent|urgente|cr[ií]tic/i.test(leadUrgency(lead));
}
