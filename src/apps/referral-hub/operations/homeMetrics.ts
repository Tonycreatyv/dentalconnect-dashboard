export const ACTIONABLE_ASSIGNMENT_WORK_STATUSES = ["new", "follow_up"] as const;

export function isActionableAssignment(workStatus: string | null | undefined): boolean {
  return ACTIONABLE_ASSIGNMENT_WORK_STATUSES.includes(workStatus as typeof ACTIONABLE_ASSIGNMENT_WORK_STATUSES[number]);
}

export function isCurrentActionableAssignment(assignment: { workStatus: string | null | undefined; requestStatus?: string | null }): boolean {
  // Request status is intentionally not a guard. An assigned prequalified
  // request is real partner work; only the assignment's work status decides
  // whether it belongs in the current queue.
  return isActionableAssignment(assignment.workStatus);
}

// A lead is the only identity available to both canonical request sources.
// Null identities are deliberately ignored rather than counted as one shared
// anonymous customer.
export function uniqueBusinessLeadCount(
  couponLeadIds: readonly (string | null | undefined)[],
  serviceRequestLeadIds: readonly (string | null | undefined)[],
): number {
  const ids = new Set<string>();
  for (const leadId of [...couponLeadIds, ...serviceRequestLeadIds]) {
    if (leadId) ids.add(leadId);
  }
  return ids.size;
}
