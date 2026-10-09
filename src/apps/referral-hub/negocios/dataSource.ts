import { auditedNegociosDataSource } from "./auditedDataSource";
import type { NegociosDataSource } from "./types";

// The operational /negocios view reads real production data by default.
// Partner create/update writes are routed through the authenticated,
// audited admin-partner-management Edge Function; all other capabilities
// remain delegated to the existing production-backed datasource.
export function getActiveNegociosDataSource(): NegociosDataSource {
  return auditedNegociosDataSource;
}
