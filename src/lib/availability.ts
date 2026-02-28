const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type HoursMap = Record<string, { closed?: boolean; open?: string; close?: string }>;

export function getDayKey(d: Date) {
  return DAY_KEYS[d.getDay()];
}

export function defaultHours(): HoursMap {
  return {
    mon: { closed: false, open: "08:00", close: "17:00" },
    tue: { closed: false, open: "08:00", close: "17:00" },
    wed: { closed: false, open: "08:00", close: "17:00" },
    thu: { closed: false, open: "08:00", close: "17:00" },
    fri: { closed: false, open: "08:00", close: "17:00" },
    sat: { closed: false, open: "09:00", close: "13:00" },
    sun: { closed: true },
  };
}

export function slotToMinutes(slot: string) {
  const [h, m] = slot.split(":").map((x) => Number(x));
  return h * 60 + m;
}

export function minutesToSlot(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function generateTimeSlots(open: string, close: string, interval = 15) {
  const start = slotToMinutes(open);
  const end = slotToMinutes(close);
  const out: string[] = [];
  for (let m = start; m < end; m += interval) out.push(minutesToSlot(m));
  return out;
}
