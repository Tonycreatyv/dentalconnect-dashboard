import { countActiveAutomations, countActiveOrders, countHumanInterventions, groceryLocations, groceryPartnerIds, isProfessionalPartner, latestFailedNotifications } from "../src/apps/referral-hub/operations/referralDataMapping.ts";
import type { ReferralOrderListItem } from "../src/referral/orders.ts";

function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
const order = (status: ReferralOrderListItem["status"]) => ({ status } as ReferralOrderListItem);

Deno.test("active order count excludes terminal orders", () => {
  assert(countActiveOrders([order("submitted"), order("confirmed"), order("preparing"), order("ready"), order("out_for_delivery"), order("delivered"), order("cancelled")]) === 5, "terminal orders leaked into active count");
});

Deno.test("operational exceptions and failures populate intervention", () => {
  const total = countHumanInterventions([{ status: "open" }, { status: "resolved" }], [{ status: "failed" }], [{ status: "assigned", acceptance_deadline: "2000-01-01T00:00:00Z" }]);
  assert(total === 3, "real human-required conditions were omitted");
});

Deno.test("only the latest failed notification attempt requires intervention", () => {
  const rows = latestFailedNotifications([
    { id: "1", assignment_id: "a", attempt_number: 1, status: "failed", created_at: "2026-01-01" },
    { id: "2", assignment_id: "a", attempt_number: 2, status: "delivered", created_at: "2026-01-02" },
    { id: "3", assignment_id: "b", attempt_number: 1, status: "failed", created_at: "2026-01-01" },
  ]);
  assert(rows.length === 1 && rows[0].assignment_id === "b", "superseded failures were counted as permanent");
});

Deno.test("active automation count uses requests and conversation operations without duplicates", () => {
  assert(countActiveAutomations([{ lead_id: "a", status: "collecting" }, { lead_id: "b", status: "closed" }], [{ lead_id: "a", status: "pending" }, { lead_id: "c", status: "pending", automation_paused: false }]) === 2, "automation mapping is incorrect");
});

Deno.test("professional partners are not excluded merely for having locations", () => {
  const rules = [{ partner_id: "legal", service_id: "luis_accidente", active: true }, { partner_id: "store", service_id: "luis_compra_super", active: true }];
  const locations = [{ id: "office", partner_id: "legal", active: true }, { id: "shop", partner_id: "store", active: true }];
  const offers = [{ partner_location_id: "shop", active: true }];
  const groceryIds = groceryPartnerIds(rules, locations, offers);
  assert(isProfessionalPartner({ id: "legal" }, rules, groceryIds), "legal ally was removed because it has an office location");
  assert(!isProfessionalPartner({ id: "store" }, rules, groceryIds), "grocery-only partner leaked into professional allies");
});

Deno.test("stores require active grocery participation", () => {
  const partners = [{ id: "legal" }, { id: "store" }];
  const locations = [{ id: "office", partner_id: "legal", active: true }, { id: "shop", partner_id: "store", active: true }, { id: "closed", partner_id: "store", active: false }];
  const rules = [{ partner_id: "store", service_id: "luis_compra_super", active: true }];
  const stores = groceryLocations(partners, locations, rules, []);
  assert(stores.length === 1 && stores[0].id === "shop", "store classification mixed office or inactive locations");
});

Deno.test("query failures are rendered as errors rather than empty states", async () => {
  const hook = await Deno.readTextFile(new URL("../src/apps/referral-hub/operations/useOperationalPilot.ts", import.meta.url));
  const screen = await Deno.readTextFile(new URL("../src/apps/referral-hub/screens/CoreScreens.tsx", import.meta.url));
  assert(hook.includes("queryErrors"), "per-source query errors are not preserved");
  assert(screen.includes("<Failure>"), "operator-facing error state is not rendered");
  assert(screen.includes("data.queryErrors"), "network screens still treat failures as empty data");
});
