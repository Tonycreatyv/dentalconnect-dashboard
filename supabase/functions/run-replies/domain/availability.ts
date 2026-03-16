type DayHours = { closed: boolean; open?: string; close?: string };
type HoursMap = Record<string, DayHours>;

const DAY_KEYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const JS_DAY_TO_KEY: Record<number, string> = {
  0: "domingo",
  1: "lunes",
  2: "martes",
  3: "miercoles",
  4: "jueves",
  5: "viernes",
  6: "sabado",
};

const DEFAULT_HOURS: HoursMap = {
  lunes: { closed: false, open: "08:00", close: "17:00" },
  martes: { closed: false, open: "08:00", close: "17:00" },
  miercoles: { closed: false, open: "08:00", close: "17:00" },
  jueves: { closed: false, open: "08:00", close: "17:00" },
  viernes: { closed: false, open: "08:00", close: "17:00" },
  sabado: { closed: false, open: "08:00", close: "12:00" },
  domingo: { closed: true },
};

const HOURS_KEY_ALIASES: Record<string, string> = {
  mon: "lunes",
  tue: "martes",
  wed: "miercoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sabado",
  sun: "domingo",
  monday: "lunes",
  tuesday: "martes",
  wednesday: "miercoles",
  thursday: "jueves",
  friday: "viernes",
  saturday: "sabado",
  sunday: "domingo",
  lunes: "lunes",
  martes: "martes",
  miercoles: "miercoles",
  miércoles: "miercoles",
  jueves: "jueves",
  viernes: "viernes",
  sabado: "sabado",
  sábado: "sabado",
  domingo: "domingo",
};

export interface AvailableSlot {
  date: string;
  dayLabel: string;
  time: string;
}

function normalizeHours(hours: HoursMap | Record<string, unknown> | null | undefined): HoursMap {
  const normalized: HoursMap = { ...DEFAULT_HOURS };
  const source = hours && typeof hours === "object" ? hours : {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const dayKey = HOURS_KEY_ALIASES[String(rawKey).toLowerCase()];
    if (!dayKey || !rawValue || typeof rawValue !== "object") continue;
    const value = rawValue as Record<string, unknown>;
    normalized[dayKey] = {
      closed: Boolean(value.closed),
      open: typeof value.open === "string" ? value.open : normalized[dayKey]?.open,
      close: typeof value.close === "string" ? value.close : normalized[dayKey]?.close,
    };
  }

  return normalized;
}

export async function getAvailableSlots(args: {
  supabase: any;
  organizationId: string;
  hours: HoursMap | Record<string, unknown>;
  daysAhead?: number;
  slotDurationMin?: number;
}): Promise<AvailableSlot[]> {
  const { supabase, organizationId, daysAhead = 5, slotDurationMin = 30 } = args;
  const slots: AvailableSlot[] = [];
  const hours = normalizeHours(args.hours);
  const now = new Date();

  let daysChecked = 0;
  let dayOffset = 1;

  while (daysChecked < daysAhead && dayOffset < 14) {
    const checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + dayOffset);
    dayOffset++;

    const dayKey = JS_DAY_TO_KEY[checkDate.getDay()];
    const dayConfig = hours[dayKey];
    if (!dayConfig || dayConfig.closed) continue;

    const openTime = dayConfig.open ?? "08:00";
    const closeTime = dayConfig.close ?? "17:00";
    const dateStr = checkDate.toISOString().slice(0, 10);

    const { data: existingAppts } = await supabase
      .from("appointments")
      .select("start_at, starts_at, appointment_time, status")
      .eq("organization_id", organizationId)
      .gte("start_at", `${dateStr}T00:00:00`)
      .lte("start_at", `${dateStr}T23:59:59`)
      .neq("status", "cancelled");

    const bookedTimes = new Set<string>();
    if (existingAppts) {
      for (const appt of existingAppts) {
        const t = appt.appointment_time
          || (appt.start_at ? String(appt.start_at).slice(11, 16) : null)
          || (appt.starts_at ? String(appt.starts_at).slice(11, 16) : null);
        if (t) bookedTimes.add(String(t));
      }
    }

    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    for (let m = openMinutes; m < closeMinutes; m += slotDurationMin) {
      const slotTime = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      if (bookedTimes.has(slotTime)) continue;

      const dayIdx = DAY_KEYS.indexOf(dayKey);
      const dayNum = checkDate.getDate();
      const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const monthLabel = monthNames[checkDate.getMonth()];

      slots.push({
        date: dateStr,
        dayLabel: `${DAY_LABELS[dayIdx]} ${dayNum} ${monthLabel}`,
        time: slotTime,
      });
    }

    daysChecked++;
  }

  return slots;
}

export function formatSlotsMessage(slots: AvailableSlot[], maxDays = 3, maxSlotsPerDay = 5): string {
  const grouped: Record<string, AvailableSlot[]> = {};
  for (const slot of slots) {
    if (!grouped[slot.date]) grouped[slot.date] = [];
    grouped[slot.date].push(slot);
  }

  const days = Object.entries(grouped).slice(0, maxDays);
  if (days.length === 0) {
    return "No tenemos disponibilidad esta semana. ¿Te gustaría que te contactemos cuando haya espacio?";
  }

  return days
    .map(([, daySlots]) => {
      const label = daySlots[0].dayLabel;
      const times = daySlots.slice(0, maxSlotsPerDay).map((slot) => slot.time).join(", ");
      return `📅 ${label} — ${times}`;
    })
    .join("\n");
}
