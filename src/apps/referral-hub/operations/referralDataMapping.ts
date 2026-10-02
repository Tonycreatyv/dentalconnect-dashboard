import type { ReferralOrderListItem } from "../../../referral/orders";

const ACTIVE_REQUEST_STATUSES = new Set(["new", "collecting", "prequalified", "qualified"]);
const ACTIVE_ASSIGNMENT_STATUSES = new Set(["pending_assignment", "assigned", "accepted"]);
const TERMINAL_ORDER_STATUSES = new Set(["delivered", "cancelled"]);
type DataRow = Record<string, unknown>;

export function countActiveOrders(orders: ReferralOrderListItem[]) {
  return orders.filter((order) => !TERMINAL_ORDER_STATUSES.has(order.status)).length;
}

export function countActiveAutomations(requests: DataRow[], conversationOperations: DataRow[]) {
  const activeLeadIds = new Set(
    conversationOperations
      .filter((operation) => operation.status === "pending" && operation.automation_paused !== true)
      .map((operation) => String(operation.lead_id)),
  );
  const activeRequestLeads = new Set(
    requests
      .filter((request) => ACTIVE_REQUEST_STATUSES.has(String(request.status)))
      .map((request) => String(request.lead_id)),
  );
  return new Set([...activeLeadIds, ...activeRequestLeads]).size;
}

export function countHumanInterventions(exceptions: DataRow[], notifications: DataRow[], assignments: DataRow[]) {
  const openExceptions = exceptions.filter((item) => item.status === "open").length;
  const permanentFailures = latestFailedNotifications(notifications).length;
  const expiredAssignments = assignments.filter((item) =>
    ACTIVE_ASSIGNMENT_STATUSES.has(String(item.status)) && item.acceptance_deadline &&
    +new Date(String(item.acceptance_deadline)) < Date.now()
  ).length;
  return openExceptions + permanentFailures + expiredAssignments;
}

export function latestFailedNotifications(notifications: DataRow[]) {
  const latest = new Map<string, DataRow>();
  for (const notification of notifications) {
    const key = String(notification.assignment_id ?? notification.id ?? "");
    const current = latest.get(key);
    const attempt = Number(notification.attempt_number ?? 0);
    const currentAttempt = Number(current?.attempt_number ?? 0);
    const createdAt = +new Date(String(notification.created_at ?? 0));
    const currentCreatedAt = +new Date(String(current?.created_at ?? 0));
    if (!current || attempt > currentAttempt || (attempt === currentAttempt && createdAt > currentCreatedAt)) latest.set(key, notification);
  }
  return [...latest.values()].filter((notification) => notification.status === "failed");
}

export function isGroceryService(serviceId: unknown) {
  const value = String(serviceId ?? "").toLowerCase();
  return value.includes("compra_super") || value.includes("grocery") || value.includes("canasta");
}

export function groceryPartnerIds(rules: DataRow[], locations: DataRow[], offers: DataRow[]) {
  const ids = new Set(
    rules.filter((rule) => rule.active !== false && isGroceryService(rule.service_id))
      .map((rule) => String(rule.partner_id)),
  );
  const offeredLocationIds = new Set(offers.filter((offer) => offer.active !== false).map((offer) => String(offer.partner_location_id)));
  for (const location of locations) {
    if (location.active !== false && offeredLocationIds.has(String(location.id))) ids.add(String(location.partner_id));
  }
  return ids;
}

export function isProfessionalPartner(partner: DataRow, rules: DataRow[], groceryIds: Set<string>) {
  const partnerRules = rules.filter((rule) => String(rule.partner_id) === String(partner.id) && rule.active !== false);
  const hasProfessionalRule = partnerRules.some((rule) => !isGroceryService(rule.service_id));
  return hasProfessionalRule || !groceryIds.has(String(partner.id));
}

export function groceryLocations(partners: DataRow[], locations: DataRow[], rules: DataRow[], offers: DataRow[]) {
  const partnerIds = groceryPartnerIds(rules, locations, offers);
  const knownPartners = new Set(partners.map((partner) => String(partner.id)));
  return locations.filter((location) =>
    location.active !== false && knownPartners.has(String(location.partner_id)) &&
    partnerIds.has(String(location.partner_id))
  );
}
