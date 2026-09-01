import type { ImmigrationInboxRow } from "./immigrationInbox";

export type ImmigrationAssignment = {
  id: string;
  status: string;
  workStatus: string;
  assignedAt: string;
  updatedAt: string;
  partnerName: string | null;
};

export type ImmigrationOpportunity = ImmigrationInboxRow & {
  assignment: ImmigrationAssignment | null;
  operationalStatus: string;
  recommendedAction: string;
  lastActivityAt: string;
};

export function resolveImmigrationOpportunity(
  request: ImmigrationInboxRow,
  assignment: ImmigrationAssignment | null,
): ImmigrationOpportunity {
  const workStatus = assignment?.workStatus;
  const status = assignment?.status;
  const operationalStatus = !assignment
    ? request.consentStatus === "authorized" ? "Sin aliado disponible" : "En espera de consentimiento"
    : status === "assigned" ? "Nueva asignación"
    : status === "rejected" ? "Rechazada por aliado"
    : workStatus === "contacted" ? "Contactado"
    : workStatus === "appointment_scheduled" ? "Cita programada"
    : workStatus === "converted" ? "Convertido"
    : workStatus === "not_converted" ? "Cerrado sin conversión"
    : "Pendiente de seguimiento";
  const recommendedAction = !assignment
    ? request.consentStatus === "authorized" ? "Revisar aliado disponible" : "Esperar consentimiento"
    : status === "assigned" ? "Aliado debe contactar"
    : status === "rejected" ? "Reasignar o revisar excepción"
    : workStatus === "contacted" ? "Esperar respuesta o registrar cita"
    : workStatus === "appointment_scheduled" ? "Dar seguimiento a la cita"
    : workStatus === "converted" || workStatus === "not_converted" ? "Sin acción pendiente"
    : "Dar seguimiento";
  return { ...request, assignment, operationalStatus, recommendedAction, lastActivityAt: assignment?.updatedAt || request.createdAt };
}
