export interface SlotView {
  date: string;
  dayLabel: string;
  time: string;
}

function toMinutes(time: string): number {
  const m = String(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isAdjacent(a: SlotView, b: SlotView): boolean {
  if (a.date !== b.date) return false;
  return Math.abs(toMinutes(a.time) - toMinutes(b.time)) === 30;
}

function dayLabelLong(dayLabel: string): string {
  return dayLabel
    .replace("Lun", "Lunes")
    .replace("Mar", "Martes")
    .replace("Mié", "Miércoles")
    .replace("Jue", "Jueves")
    .replace("Vie", "Viernes")
    .replace("Sáb", "Sábado")
    .replace("Dom", "Domingo");
}

function bucket(time: string): "morning" | "afternoon" | "evening" {
  const mins = toMinutes(time);
  if (mins < 12 * 60) return "morning";
  if (mins < 17 * 60) return "afternoon";
  return "evening";
}

function uniqueByDateTime(slots: SlotView[]): SlotView[] {
  const seen = new Set<string>();
  const out: SlotView[] = [];
  for (const s of slots) {
    const key = `${s.date}|${s.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function pickVariedGeneralSlots(slots: SlotView[], max = 3): SlotView[] {
  const ordered = uniqueByDateTime(slots).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return toMinutes(a.time) - toMinutes(b.time);
  });
  if (ordered.length <= 1) return ordered;

  const chosen: SlotView[] = [];
  const usedKeys = new Set<string>();
  const pushIfValid = (slot: SlotView | undefined) => {
    if (!slot) return;
    const key = `${slot.date}|${slot.time}`;
    if (usedKeys.has(key)) return;
    if (chosen.some((c) => isAdjacent(c, slot))) return;
    usedKeys.add(key);
    chosen.push(slot);
  };

  const buckets: Array<"morning" | "afternoon" | "evening"> = ["morning", "afternoon", "evening"];
  for (const b of buckets) {
    pushIfValid(ordered.find((s) => bucket(s.time) === b));
    if (chosen.length >= max) return chosen;
  }

  for (const slot of ordered) {
    pushIfValid(slot);
    if (chosen.length >= max) break;
  }

  if (chosen.length === 0 && ordered.length > 0) return [ordered[0]];
  return chosen;
}

export function pickSpecificDaySlots(slots: SlotView[], max = 3): SlotView[] {
  const ordered = uniqueByDateTime(slots).sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  if (ordered.length <= max) return ordered;
  const first = ordered[0];
  const middle = ordered[Math.floor(ordered.length / 2)];
  const last = ordered[ordered.length - 1];
  return uniqueByDateTime([first, middle, last]).slice(0, max);
}

export function shouldSummarizeAdjacentMorning(slots: SlotView[]): boolean {
  if (slots.length < 2) return false;
  const ordered = [...slots].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  const allMorning = ordered.every((s) => bucket(s.time) === "morning");
  if (!allMorning) return false;
  for (let i = 1; i < ordered.length; i++) {
    if (!isAdjacent(ordered[i - 1], ordered[i])) return false;
  }
  return true;
}

export function formatGeneralAvailability(service: string, slots: SlotView[], formatHourLabel: (t: string) => string): string {
  const picks = pickVariedGeneralSlots(slots, 3);
  const lines = picks.map((s) => `• ${dayLabelLong(s.dayLabel)} ${formatHourLabel(s.time)}`);
  return `Para ${service} tengo estas opciones:\n${lines.join("\n")}\n\n¿Cuál te queda mejor?`;
}

export function formatSpecificDayAvailability(
  dayLabel: string,
  slots: SlotView[],
  formatHourLabel: (t: string) => string,
): string {
  const picks = pickSpecificDaySlots(slots, 3);
  if (shouldSummarizeAdjacentMorning(picks)) {
    const ordered = [...picks].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    const start = formatHourLabel(ordered[0].time);
    const end = formatHourLabel(ordered[ordered.length - 1].time);
    return `Para ${dayLabel.toLowerCase()} tengo disponibilidad en la mañana, entre ${start} y ${end}. ¿Te queda bien ${start} o preferís que busque otro día?`;
  }
  const lines = picks.map((s) => `• ${formatHourLabel(s.time)}`);
  return `Para ${dayLabel.toLowerCase()} tengo estos horarios:\n${lines.join("\n")}\n\n¿Cuál te queda mejor?`;
}
