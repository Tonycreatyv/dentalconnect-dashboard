import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  REFERRAL_ORDER_NEXT_STATUSES,
  REFERRAL_ORDER_STATUS_LABELS,
} from "../src/referral/orders.ts";

Deno.test("Referral order states match the production RPC exactly", () => {
  assertEquals(Object.keys(REFERRAL_ORDER_STATUS_LABELS), [
    "submitted",
    "confirmed",
    "preparing",
    "ready",
    "out_for_delivery",
    "delivered",
    "cancelled",
  ]);
  assertEquals(REFERRAL_ORDER_NEXT_STATUSES.submitted, [
    "confirmed",
    "cancelled",
  ]);
  assertEquals(REFERRAL_ORDER_NEXT_STATUSES.confirmed, [
    "preparing",
    "cancelled",
  ]);
  assertEquals(REFERRAL_ORDER_NEXT_STATUSES.preparing, ["ready", "cancelled"]);
  assertEquals(REFERRAL_ORDER_NEXT_STATUSES.ready, [
    "out_for_delivery",
    "cancelled",
  ]);
  assertEquals(REFERRAL_ORDER_NEXT_STATUSES.out_for_delivery, [
    "delivered",
    "cancelled",
  ]);
  assertEquals(REFERRAL_ORDER_NEXT_STATUSES.delivered, []);
  assertEquals(REFERRAL_ORDER_NEXT_STATUSES.cancelled, []);
  assert(!Object.keys(REFERRAL_ORDER_STATUS_LABELS).includes("accepted"));
});
