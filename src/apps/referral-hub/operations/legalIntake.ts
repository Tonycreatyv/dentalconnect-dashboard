// Parses the ONLY place a completed immigration/accident/DUI intake from
// the real, published Luis Unified Services WhatsApp Flow is actually
// persisted: leads.state.collected.luis_legal_last_completed (see
// buildLuisLegalFlowCompletionResult in run-replies/index.ts). That
// completion never writes a referral_service_requests row — that table is
// only reachable from the older, no-longer-primary conversational text
// menu (genericMenuRouter.ts) — so any dashboard count that wants to
// reflect real Flow-driven submissions must read leads.state, not that
// table. This module is the single, shared parser so every screen that
// needs this data reads it the same way.
import type { LuisServiceId } from "./luisCatalog";

export type LegalIntakeType = "IMMIGRATION" | "AUTO_ACCIDENT" | "DUI_CRIMINAL";

export type LegalIntake = {
  intakeType: LegalIntakeType;
  topic: string | null;
  postalCode: string | null;
  description: string;
  completedAt: string | null;
};

// Mirrors SERVICE_REQUEST_LABEL/FOLLOW_UP_SERVICE_IDS grouping used
// elsewhere: DUI_CRIMINAL and AUTO_ACCIDENT are both shown under the
// combined "Accidente / DUI / Criminal" service row, never their own row.
export const LEGAL_INTAKE_SERVICE_ID: Record<LegalIntakeType, LuisServiceId> = {
  IMMIGRATION: "luis_inmigracion",
  AUTO_ACCIDENT: "luis_accidente",
  DUI_CRIMINAL: "luis_accidente",
};

const IMMIGRATION_TOPIC_LABELS: Record<string, string> = {
  CONSULTATION: "Consulta de inmigración",
  GREEN_CARD: "Residencia / Green Card",
  CITIZENSHIP: "Ciudadanía",
  WORK_PERMIT: "Permiso de trabajo",
  FAMILY_PETITION: "Petición familiar",
  IMMIGRATION_COURT: "Corte de inmigración",
  OTHER: "Otro",
};
const DUI_TOPIC_LABELS: Record<string, string> = {
  DUI: "DUI",
  ARREST: "Arresto o detención",
  CRIMINAL_CHARGE: "Cargo criminal",
  COURT_SUMMONS: "Citación / corte",
  OTHER: "Otro",
};

export function legalTopicLabel(intake: LegalIntake): string | null {
  if (!intake.topic) return null;
  if (intake.intakeType === "IMMIGRATION") return IMMIGRATION_TOPIC_LABELS[intake.topic] || intake.topic;
  if (intake.intakeType === "DUI_CRIMINAL") return DUI_TOPIC_LABELS[intake.topic] || intake.topic;
  return intake.topic;
}

export function parseLegalIntake(state: unknown): LegalIntake | null {
  const completed = (state as { collected?: { luis_legal_last_completed?: unknown } } | null)
    ?.collected?.luis_legal_last_completed as Record<string, unknown> | undefined;
  if (!completed || typeof completed !== "object") return null;
  const intakeType = completed.intake_type;
  if (intakeType !== "IMMIGRATION" && intakeType !== "AUTO_ACCIDENT" && intakeType !== "DUI_CRIMINAL") return null;
  const description = typeof completed.description === "string" ? completed.description : "";
  if (!description) return null;
  return {
    intakeType,
    topic: typeof completed.topic === "string" ? completed.topic : null,
    postalCode: typeof completed.postal_code === "string" ? completed.postal_code : null,
    description,
    completedAt: typeof completed.completed_at === "string" ? completed.completed_at : null,
  };
}
