export type ImmigrationConsentStatus = "authorized" | "declined" | "pending_review";

export type ImmigrationInboxRow = {
  id: string;
  leadId: string;
  leadName: string;
  channelUserId: string | null;
  topic: string | null;
  description: string | null;
  postalCode: string | null;
  consentStatus: ImmigrationConsentStatus;
  consentVersion: string | null;
  consentCapturedAt: string | null;
  intakeComplete: boolean;
  status: string;
  caseCycle: number;
  createdAt: string;
};

const TOPIC_LABELS: Record<string, string> = {
  CONSULTATION: "Consulta de inmigración",
  GREEN_CARD: "Residencia / Green Card",
  CITIZENSHIP: "Ciudadanía",
  WORK_PERMIT: "Permiso de trabajo",
  FAMILY_PETITION: "Petición familiar",
  IMMIGRATION_COURT: "Corte de inmigración",
  OTHER: "Otro",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function immigrationTopicLabel(topic: string | null): string {
  return topic ? TOPIC_LABELS[topic] ?? topic : "Tema pendiente";
}

export function normalizeImmigrationConsent(value: unknown): ImmigrationConsentStatus {
  const status = text((value as { status?: unknown } | null)?.status)?.toLowerCase();
  return status === "authorized" || status === "declined" ? status : "pending_review";
}

export function immigrationReadinessLabel(row: Pick<ImmigrationInboxRow, "consentStatus" | "intakeComplete" | "topic" | "description">): string {
  if (row.consentStatus === "declined") return "Consentimiento rechazado";
  if (row.consentStatus === "pending_review") return "Consentimiento pendiente";
  if (!row.intakeComplete || !row.topic || !row.description) return "Datos incompletos";
  return "Listo para revisión interna";
}

export function immigrationReadinessTone(row: Pick<ImmigrationInboxRow, "consentStatus" | "intakeComplete" | "topic" | "description">): "success" | "warning" | "danger" {
  if (row.consentStatus === "declined") return "danger";
  if (row.consentStatus === "pending_review" || !row.intakeComplete || !row.topic || !row.description) return "warning";
  return "success";
}

export function immigrationInboxTotals(rows: ImmigrationInboxRow[]) {
  return rows.reduce((totals, row) => {
    totals.total += 1;
    if (row.consentStatus === "authorized") totals.authorized += 1;
    if (row.consentStatus === "declined") totals.declined += 1;
    if (row.consentStatus === "pending_review") totals.pending += 1;
    if (immigrationReadinessLabel(row) === "Listo para revisión interna") totals.ready += 1;
    return totals;
  }, { total: 0, authorized: 0, declined: 0, pending: 0, ready: 0 });
}
