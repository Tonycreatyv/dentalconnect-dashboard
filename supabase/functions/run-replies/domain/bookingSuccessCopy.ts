import { toPatientFacingServiceLabel } from "./serviceInfoHandler.ts";

function safeStr(x: unknown, d = ""): string {
  if (typeof x === "string") return x;
  if (x == null) return d;
  return String(x);
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const normalized = safeStr(value, "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function toDisplayPersonName(rawName: string): string {
  const name = safeStr(rawName, "").trim();
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatHourLabel(time24: string): string {
  const [hRaw, mRaw] = time24.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time24;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatRequestedDayLabel(dateIso: string): string {
  if (!dateIso) return "ese día";
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.valueOf())) return dateIso;
  return d.toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).toLowerCase();
}

export function formatBookingSuccessCopy(args: {
  booking:
    | {
      ok: boolean;
      appointment?: Record<string, unknown>;
    }
    | null
    | undefined;
  fallback: string;
  businessType?: string;
  preferredBarberFallback?: string;
  brandName?: string;
}): string {
  if (!args.booking || args.booking.ok !== true) return args.fallback;

  const appt = (args.booking.appointment ?? {}) as Record<string, unknown>;
  const businessType = safeStr(args.businessType, "").toLowerCase();
  const date = safeStr(
    appt.appointment_date,
    safeStr(appt.starts_at, "").slice(0, 10),
  );
  const humanDate = formatRequestedDayLabel(date);
  const time = safeStr(
    appt.appointment_time,
    safeStr(appt.starts_at, "").slice(11, 16),
  );
  const serviceRaw = safeStr(
    appt.reason,
    safeStr(appt.title, "Revisión dental"),
  );
  const service = toPatientFacingServiceLabel(serviceRaw);

  if (businessType === "barbershop") {
    const preferredBarberRaw = firstNonEmpty(
      (appt as any).preferred_barber,
      (appt as any).provider_name,
      (appt as any).barber_name,
      (appt as any).barber,
      ((appt as any).metadata ?? {})?.preferred_barber,
      args.preferredBarberFallback,
    );
    const preferredBarber = toDisplayPersonName(preferredBarberRaw);
    const provider = preferredBarber || "Barbero disponible";
    const brandName = safeStr(args.brandName, "la barbería");
    return `✅ Cita confirmada 💈

Te esperamos en ${brandName}:

✂️ Servicio: ${service}
💈 Barbero: ${provider}
📅 Fecha: ${humanDate}
🕝 Hora: ${formatHourLabel(time)}

Si necesitás cambiarla o cancelarla, podés escribirnos por aquí.`;
  }

  const patientName = toDisplayPersonName(safeStr(appt.patient_name, ""));
  const leadName = toDisplayPersonName(
    safeStr(
      (appt as any)?.lead_full_name,
      safeStr((appt as any)?.lead_name, ""),
    ),
  );
  const relation = safeStr((appt as any)?.appointment_for_relation, "").trim()
    .toLowerCase();
  const isThirdPartyAppointment = Boolean(
    (relation && relation !== "self") ||
      (patientName && leadName &&
        patientName.toLowerCase() !== leadName.toLowerCase()),
  );
  const headline = isThirdPartyAppointment
    ? `✅ Listo, la cita de ${patientName} quedó agendada.`
    : "✅ Listo, tu cita quedó agendada.";
  const reminderCopy = isThirdPartyAppointment
    ? "Te enviaremos un recordatorio antes de la cita."
    : "Te enviaremos un recordatorio antes de tu cita.";
  return `${headline}\n\n🦷 ${service}\n📅 ${humanDate}\n⏰ ${
    formatHourLabel(time)
  }\n\n${reminderCopy}`;
}
