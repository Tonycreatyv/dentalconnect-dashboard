export type AdminOperationalQueueId = "today" | "unassigned" | "exceptions" | "active";

export type AdminQueueAssignment = {
  status: string;
  workStatus: string;
  assignedAt: string;
  updatedAt: string;
  partnerName: string | null;
  nextFollowupAt?: string | null;
  followUpReason?: string | null;
};

export type AdminQueueOpportunity = {
  id: string;
  createdAt: string;
  intakeComplete: boolean;
  consentStatus: string;
  operationalStatus: string;
  lastActivityAt: string;
  assignment: AdminQueueAssignment | null;
};

const CLOSED_WORK_STATUSES = new Set(["converted", "not_converted", "closed"]);
const EXCEPTION_ASSIGNMENT_STATUSES = new Set(["rejected", "expired"]);

function time(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function endOfLocalDay(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

export function isAdminActiveOpportunity(opportunity: AdminQueueOpportunity): boolean {
  const workStatus = opportunity.assignment?.workStatus ?? "";
  return !CLOSED_WORK_STATUSES.has(workStatus)
    && opportunity.operationalStatus !== "Convertido"
    && opportunity.operationalStatus !== "Cerrado sin conversión";
}

export function isAdminUnassignedOpportunity(opportunity: AdminQueueOpportunity): boolean {
  return isAdminActiveOpportunity(opportunity)
    && !opportunity.assignment
    && opportunity.consentStatus === "authorized";
}

export function isAdminExceptionOpportunity(opportunity: AdminQueueOpportunity): boolean {
  if (!isAdminActiveOpportunity(opportunity)) return false;
  if (!opportunity.intakeComplete) return true;
  if (opportunity.consentStatus === "declined") return true;
  if (!opportunity.assignment && opportunity.consentStatus !== "authorized") return true;
  return EXCEPTION_ASSIGNMENT_STATUSES.has(opportunity.assignment?.status ?? "");
}

export function isAdminTodayOpportunity(opportunity: AdminQueueOpportunity, now = new Date()): boolean {
  if (!isAdminActiveOpportunity(opportunity)) return false;
  if (isAdminUnassignedOpportunity(opportunity)) return true;

  const assignment = opportunity.assignment;
  if (!assignment) return false;
  if (assignment.status === "assigned" || assignment.status === "pending_assignment") return true;

  const followUpAt = time(assignment.nextFollowupAt);
  if (Number.isFinite(followUpAt)) return followUpAt <= endOfLocalDay(now);

  return assignment.workStatus === "new" || assignment.workStatus === "follow_up";
}

export function filterAdminOperationalQueue<T extends AdminQueueOpportunity>(
  opportunities: readonly T[],
  queue: AdminOperationalQueueId,
  now = new Date(),
): T[] {
  return opportunities.filter((opportunity) => {
    if (queue === "today") return isAdminTodayOpportunity(opportunity, now);
    if (queue === "unassigned") return isAdminUnassignedOpportunity(opportunity);
    if (queue === "exceptions") return isAdminExceptionOpportunity(opportunity);
    return isAdminActiveOpportunity(opportunity);
  });
}

export function adminOperationalQueueCounts<T extends AdminQueueOpportunity>(opportunities: readonly T[], now = new Date()) {
  return {
    today: filterAdminOperationalQueue(opportunities, "today", now).length,
    unassigned: filterAdminOperationalQueue(opportunities, "unassigned", now).length,
    exceptions: filterAdminOperationalQueue(opportunities, "exceptions", now).length,
    active: filterAdminOperationalQueue(opportunities, "active", now).length,
  };
}

export function sortAdminOperationalQueue<T extends AdminQueueOpportunity>(items: readonly T[], now = new Date()): T[] {
  const endToday = endOfLocalDay(now);
  const priority = (item: T): number => {
    if (isAdminUnassignedOpportunity(item)) return 0;
    if (item.assignment?.status === "assigned" || item.assignment?.status === "pending_assignment") return 1;
    const due = time(item.assignment?.nextFollowupAt);
    if (Number.isFinite(due) && due <= endToday) return 2;
    return 3;
  };

  return [...items].sort((a, b) => {
    const rank = priority(a) - priority(b);
    if (rank !== 0) return rank;
    const aDue = time(a.assignment?.nextFollowupAt);
    const bDue = time(b.assignment?.nextFollowupAt);
    if (Number.isFinite(aDue) && Number.isFinite(bDue) && aDue !== bDue) return aDue - bDue;
    return time(b.createdAt) - time(a.createdAt);
  });
}
