import type {
  InteractiveButton,
  WhatsAppInteractiveListSpec,
} from "../../_shared/metaMessageAdapter.ts";

function safeStr(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseTimeToMinutes(time: string, fallback = 0): number {
  const m = safeStr(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

function groupSlotsByPeriod(slots: Array<Record<string, unknown>>) {
  const morning: Array<Record<string, unknown>> = [];
  const afternoon: Array<Record<string, unknown>> = [];
  for (const slot of slots) {
    const target = parseTimeToMinutes(safeStr(slot.time), 0) < 12 * 60
      ? morning
      : afternoon;
    target.push(slot);
  }
  return { morning, afternoon };
}

function hasMultipleProviders(slots: Array<Record<string, unknown>>): boolean {
  const providers = new Set(
    slots
      .map((slot) => safeStr(slot.provider_id, safeStr(slot.provider_name, "")))
      .filter(Boolean),
  );
  return providers.size > 1;
}

function formatSlotLine(
  slot: Record<string, unknown>,
  showProvider: boolean,
): string {
  const time = formatBarbershopHourLabel(safeStr(slot.time));
  if (!showProvider) return `• ${time}`;
  const provider = safeStr(slot.provider_name, "Barbero");
  return `• ${time} · ${provider}`;
}

export function formatBarbershopHourLabel(time: string): string {
  const m = safeStr(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return safeStr(time);
  let hour = Number(m[1]);
  const minute = m[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

export function buildBarbershopAvailabilityButtons(
  slots: Array<Record<string, unknown>>,
  hasMore: boolean,
): InteractiveButton[] {
  if (hasMore) return [];
  const timeSlots = slots.slice(0, hasMore ? 2 : 3).map((slot) => ({
    id: `select_time:${safeStr(slot.date)}|${safeStr(slot.time)}|${
      safeStr(slot.provider_id)
    }`,
    title: formatBarbershopHourLabel(safeStr(slot.time)).slice(0, 20),
  }));
  return timeSlots;
}

export function formatBarbershopAvailabilityListBody(
  slots: Array<Record<string, unknown>>,
): string {
  const validSlots = slots.filter((slot) => safeStr(slot.time));
  const { morning, afternoon } = groupSlotsByPeriod(validSlots);
  const showProvider = hasMultipleProviders(validSlots);
  const sections: string[] = [];
  if (morning.length) {
    sections.push(
      `Por la mañana:\n${
        morning.slice(0, 4).map((slot) => formatSlotLine(slot, showProvider))
          .join("\n")
      }`,
    );
  }
  if (afternoon.length) {
    sections.push(
      `Por la tarde:\n${
        afternoon.slice(0, 4).map((slot) => formatSlotLine(slot, showProvider))
          .join("\n")
      }`,
    );
  }
  const slotText = sections.length
    ? sections.join("\n\n")
    : validSlots.slice(0, 6).map((slot) => formatSlotLine(slot, showProvider))
      .join("\n");
  return `Horarios disponibles 💈\n\nEstos son algunos horarios disponibles:\n\n${slotText}\n\nEscogé una hora para continuar.`;
}

export function buildExpandedBarbershopTimeSlotsList(args: {
  slots: Array<Record<string, unknown>>;
  body?: string;
  serviceName?: string;
  providerPreference?: "any" | "specific";
}): WhatsAppInteractiveListSpec | undefined {
  const validSlots = args.slots
    .filter((slot) => safeStr(slot.date) && safeStr(slot.time))
    .slice(0, 10);
  if (!validSlots.length) return undefined;

  const grouped = new Map<
    "Por la mañana" | "Por la tarde",
    Array<Record<string, unknown>>
  >();
  for (const slot of validSlots) {
    const section = parseTimeToMinutes(safeStr(slot.time), 0) < 12 * 60
      ? "Por la mañana"
      : "Por la tarde";
    grouped.set(section, [...(grouped.get(section) ?? []), slot]);
  }

  const providerPreference = args.providerPreference ?? "any";
  const serviceName = safeStr(args.serviceName, "Servicio");
  const showProvider = providerPreference === "any" &&
    hasMultipleProviders(validSlots);
  const sectionOrder: Array<"Por la mañana" | "Por la tarde"> = [
    "Por la mañana",
    "Por la tarde",
  ];
  return {
    title: "Horarios disponibles",
    body: safeStr(args.body, formatBarbershopAvailabilityListBody(validSlots)),
    buttonText: "Ver horarios disponibles",
    sections: sectionOrder
      .filter((title) => (grouped.get(title) ?? []).length > 0)
      .map((title) => ({
        title,
        rows: (grouped.get(title) ?? []).map((slot) => ({
          id: `select_slot:${safeStr(slot.date)}|${safeStr(slot.time)}|${
            safeStr(slot.provider_id)
          }`,
          title: showProvider
            ? `${formatBarbershopHourLabel(safeStr(slot.time))} · ${
              safeStr(slot.provider_name, "Barbero")
            }`.slice(0, 24)
            : formatBarbershopHourLabel(safeStr(slot.time)).slice(0, 24),
          description: providerPreference === "specific"
            ? `${safeStr(slot.provider_name, "Barbero")} · ${serviceName}`
              .slice(0, 72)
            : serviceName.slice(0, 72),
        })),
      })),
  };
}

export function composeBarbershopNaturalFallback(args: {
  nextExpected?: string | null;
  activeFlow?: string | null;
}): string {
  const nextExpected = String(args.nextExpected ?? "");
  const activeFlow = String(args.activeFlow ?? "");
  if (activeFlow === "booking" && !nextExpected) {
    return "Seguimos con tu cita. ¿Querés ver horarios disponibles o reservar una hora específica?";
  }
  if (nextExpected === "availability_slot_selection") {
    return "Decime la hora que te queda mejor (por ejemplo: 10, la de las 10, la primera o la última).";
  }
  if (nextExpected === "booking_date" || nextExpected === "availability_day") {
    return "Decime el día para revisarlo (por ejemplo: hoy, mañana o viernes).";
  }
  if (nextExpected === "service" || nextExpected === "availability_service") {
    return "Decime el servicio y lo reviso (corte, barba, corte + barba o cejas).";
  }
  if (nextExpected === "date_time") {
    return "Decime el día y la hora para revisar.";
  }
  if (nextExpected === "barber_preference") {
    return "¿Querés con algún barbero en especial o con cualquiera?";
  }
  return activeFlow === "booking"
    ? "Seguimos con tu cita. ¿Querés ver horarios disponibles o reservar una hora específica?"
    : "No te entendí completo. Podés escribirme algo como: quiero cita mañana a las 5.";
}
