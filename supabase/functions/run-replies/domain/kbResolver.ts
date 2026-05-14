type Json = Record<string, unknown>;

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isPriceQuestion(text: string): boolean {
  const lower = normalizeText(text);
  return /\b(precio|cuanto cuesta|costo|valor|tarifa|cuanto vale)\b/.test(lower) ||
    /\bcuanto uesta\b/.test(lower);
}

export function isDurationOrProcessQuestion(text: string): boolean {
  const lower = normalizeText(text);
  return /\b(cuanto tiempo|cuanto dura|duracion|proceso|como funciona|que incluye|duele)\b/.test(lower);
}

export function isFaqQuestion(text: string): boolean {
  const lower = normalizeText(text);
  return /\b(horario|horarios|a que hora|donde estan|ubicacion|direccion|aceptan seguro|seguro|metodos de pago|formas de pago)\b/.test(lower);
}

export type ServiceKbRecord = {
  found?: boolean;
  name?: string;
  service_name?: string;
  booking_label?: string;
  short_description?: string;
  process_summary?: string;
  typical_duration?: string;
  faq_duration?: string;
  faq_process?: string;
  price_from?: number | null;
  price_to?: number | null;
  currency?: string;
  price_policy?: string;
  faq_cost?: string;
};

export function extractRpcRow(data: unknown): Json | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === "object" ? (row as Json) : null;
  }
  if (data && typeof data === "object") return data as Json;
  return null;
}

export function buildServiceReplyFromKb(
  row: ServiceKbRecord,
  userText: string,
): { reply: string; service: string } {
  const service = safeStr(
    row.booking_label,
    safeStr(row.name, safeStr(row.service_name, "Revisión dental")),
  );
  const askPrice = isPriceQuestion(userText);
  const askDuration = isDurationOrProcessQuestion(userText);
  const from = row.price_from == null ? null : Number(row.price_from);
  const to = row.price_to == null ? null : Number(row.price_to);
  const currency = safeStr(row.currency, "").trim();

  if (askPrice) {
    if (from != null && to != null) {
      const amount = currency
        ? `${currency} ${from} y ${currency} ${to}`
        : `${from} y ${to}`;
      return {
        service,
        reply:
          `${service} tiene un precio aproximado entre ${amount}.\n\nSi querés, te ayudo a agendar una revisión para confirmarlo 😊`,
      };
    }
    const fallback = safeStr(row.faq_cost, safeStr(row.price_policy, "El precio puede variar según el caso y se confirma en revisión."));
    return {
      service,
      reply:
        `${fallback}\n\nSi querés, te ayudo a agendar esa revisión 😊`,
    };
  }

  if (askDuration) {
    const process = safeStr(
      row.process_summary,
      safeStr(row.faq_process, safeStr(row.short_description, "Te explico cómo funciona durante la revisión.")),
    );
    const duration = safeStr(
      row.typical_duration,
      safeStr(row.faq_duration, "La duración puede variar según cada caso."),
    );
    return {
      service,
      reply:
        `${process}\n\n${duration}\n\nSi querés, te ayudo a agendar esa revisión.`,
    };
  }

  const short = safeStr(row.short_description, `Te cuento sobre ${service}.`);
  return {
    service,
    reply:
      `${short}\n\n¿Querés más información o preferís agendar una revisión?`,
  };
}
