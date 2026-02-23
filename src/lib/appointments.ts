import { stableHash } from "./dedupe";

export type AppointmentLike = {
  id?: string | null;
  organization_id?: string | null;
  start_at?: string | null;
  starts_at?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  patient_name?: string | null;
  reason?: string | null;
};

export function normalizedStartISO(a: AppointmentLike): string | null {
  if (a.start_at) return a.start_at;
  if (a.starts_at) return a.starts_at;

  if (a.appointment_date) {
    const t = a.appointment_time ?? "09:00";
    const dt = new Date(`${a.appointment_date}T${t}:00`);
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

export function appointmentKey(a: AppointmentLike) {
  if (a.id) return a.id;
  const org = a.organization_id ?? "org";
  const iso = normalizedStartISO(a) ?? "time";
  const patient = a.patient_name ?? "";
  return stableHash(`${org}::${iso}::${patient}`);
}
