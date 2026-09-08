// Deliberately dependency-free (no react, no supabase) so it can be unit
// tested directly with Deno — see pastorOperations.test.ts. React/Supabase
// hooks that use these constants/classifiers live in ./useServiceRouting.ts.

// Current production scope: these are the only two services that route to a
// real partner today (Accidente de auto → Clínica Pastor; Inmigración has no
// live partner destination yet but shares the same request/assignment shape).
export const SERVICE_IDS = ["luis_accidente", "luis_inmigracion"] as const;
export const SERVICE_LABELS: Record<string, string> = { luis_accidente: "Accidente de auto", luis_inmigracion: "Inmigración" };
export const SOURCE_ORGANIZATION = "Luis Gabriel Productions";
export const PASTOR_PARTNER_ID = "93bafa9c-acae-4606-966c-c79f5c1003f1";

export type OperationalStatusCounts = { new: number; followUp: number; approved: number; disqualified: number };

// Single classifier both the per-service summary counts and the per-row
// Servicios list use, so a request's status badge can never disagree with
// the count it contributes to.
export function operationalStatusLabel(workStatus: string | null | undefined): "Nuevo" | "Seguimiento" | "Aprobado" | "No calificó" {
  if (workStatus === "converted") return "Aprobado";
  if (workStatus === "not_converted") return "No calificó";
  if (["follow_up", "contacted", "appointment_scheduled", "in_progress"].includes(workStatus ?? "")) return "Seguimiento";
  return "Nuevo";
}

export function countOperationalWorkStatuses(workStatuses: readonly (string | null | undefined)[]): OperationalStatusCounts {
  const counts: OperationalStatusCounts = { new: 0, followUp: 0, approved: 0, disqualified: 0 };
  for (const status of workStatuses) {
    const label = operationalStatusLabel(status);
    if (label === "Nuevo") counts.new += 1;
    else if (label === "Seguimiento") counts.followUp += 1;
    else if (label === "Aprobado") counts.approved += 1;
    else counts.disqualified += 1;
  }
  return counts;
}
