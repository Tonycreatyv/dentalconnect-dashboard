/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Part 15 security checks for this round's dashboard changes: the new
// reply_outbox read (useReferralOperations.ts, for real Flow-submission
// data) and the new nearest-supermarket module must never depend on a
// service-role key, and must rely on the org-scoped RLS policies that
// already exist in production (outbox_select_same_org /
// reply_outbox_select, both USING user_belongs_to_org(organization_id) /
// current_org_id() - confirmed live via `supabase db dump --linked`) rather
// than only a client-side filter, which alone would not stop a malicious
// client from omitting it.

const hookSource = await Deno.readTextFile(
  new URL("./useReferralOperations.ts", import.meta.url),
);

Deno.test("useReferralOperations never references a service-role key or bypasses org scoping", () => {
  assertEquals(/service_role/i.test(hookSource), false);
  assertEquals(/SUPABASE_SERVICE_ROLE/i.test(hookSource), false);
  // The reply_outbox query is still org-filtered client-side (defense in
  // depth) - RLS is the actual boundary (verified separately against the
  // live schema), this just confirms the client didn't drop the filter.
  assertStringIncludes(hookSource, 'from("reply_outbox")');
  assertStringIncludes(hookSource, '.eq("organization_id", resolvedOrgId)');
});

const immigrationInboxSource = await Deno.readTextFile(new URL("./useImmigrationInbox.ts", import.meta.url));

Deno.test("Immigration inbox is read-only, client-safe, and tied to the active organization", () => {
  assertEquals(/service_role/i.test(immigrationInboxSource), false);
  assertEquals(/SUPABASE_SERVICE_ROLE/i.test(immigrationInboxSource), false);
  assertStringIncludes(immigrationInboxSource, 'from("referral_service_requests")');
  assertStringIncludes(immigrationInboxSource, '.eq("organization_id", resolvedOrgId)');
  assertStringIncludes(immigrationInboxSource, '.eq("service_id", "luis_inmigracion")');
  assertEquals(/\.(insert|update|upsert|delete)\(/.test(immigrationInboxSource), false);
});

const nearestSupermarketSource = await Deno.readTextFile(
  new URL("../../../../supabase/functions/run-replies/domain/referralHub/nearestSupermarket.ts", import.meta.url),
);

Deno.test("nearestSupermarket module never hardcodes a store and always scopes by organization_id", () => {
  assertEquals(/service_role/i.test(nearestSupermarketSource), false);
  assertStringIncludes(nearestSupermarketSource, "organization_id");
  // No literal supermarket business names baked into the module - real
  // locations must always come from the database, never a fixture.
  for (const forbidden of ["El Sol", "Mi Tierra", "El Güero", "Talpa", "El Progreso"]) {
    assertEquals(nearestSupermarketSource.includes(forbidden), false);
  }
});

// Configuración (Task 2) reads org_settings, a table that also stores
// meta_page_access_token/whatsapp_access_token/meta_page_secret_id -
// real secrets. The screen must select only the safe status columns it
// actually renders, never "*", and must always scope by organization_id
// (RLS is the real boundary, but the client should never even attempt a
// broader read).
const configuracionSource = await Deno.readTextFile(
  new URL("../pages/ReferralConfiguracion.tsx", import.meta.url),
);

Deno.test("Configuración never selects '*' or a secret column from org_settings, and stays org-scoped", () => {
  assertEquals(/service_role/i.test(configuracionSource), false);
  assertEquals(configuracionSource.includes('select("*")'), false);
  for (const secretColumn of ["access_token", "meta_page_secret_id", "meta_page_id"]) {
    assertEquals(configuracionSource.includes(secretColumn), false);
  }
  assertStringIncludes(configuracionSource, 'from("org_settings")');
  assertStringIncludes(configuracionSource, ".eq(\"organization_id\", resolvedOrgId)");
});

// realDataSource.ts (Task 1/3 business+coupon editing) must stay org-scoped
// even though writes are session-local overlays, not real Supabase writes -
// the reads it still performs for listBusinesses/listCoupons must never
// drop the organization filter.
const realDataSourceSource = await Deno.readTextFile(
  new URL("../negocios/realDataSource.ts", import.meta.url),
);

Deno.test("realDataSource never references a service-role key and every real query stays organization-scoped", () => {
  assertEquals(/service_role/i.test(realDataSourceSource), false);
  assertEquals(/SUPABASE_SERVICE_ROLE/i.test(realDataSourceSource), false);
  const queryBlocks = realDataSourceSource.split(".from(").slice(1);
  for (const block of queryBlocks) {
    assertStringIncludes(block.slice(0, 400), "ORGANIZATION_ID");
  }
});

// Supermarket coupon multi-location fix: listSupermarketLocations must read
// through the same loadLocations() helper listBusinesses() already uses -
// the one with .eq("active", true) - never a second, unfiltered query that
// could surface a paused/inactive location's stale image.
Deno.test("listSupermarketLocations reuses the active-only location loader, never a separate unfiltered query", () => {
  const methodStart = realDataSourceSource.indexOf("async listSupermarketLocations");
  const methodEnd = realDataSourceSource.indexOf("\n  }", methodStart);
  const methodBody = realDataSourceSource.slice(methodStart, methodEnd);
  assertStringIncludes(methodBody, "loadLocations()");
  const loaderStart = realDataSourceSource.indexOf("async function loadLocations");
  const loaderEnd = realDataSourceSource.indexOf("\n}", loaderStart);
  assertStringIncludes(realDataSourceSource.slice(loaderStart, loaderEnd), '.eq("active", true)');
});

// updateSupermarketLocation must key its write purely off the location id -
// never the shared coupon/campaign id - so an edit can never leak into
// another store's image or the campaign row itself.
Deno.test("updateSupermarketLocation is scoped to a single location id, never the shared campaign", () => {
  const methodStart = realDataSourceSource.indexOf("async updateSupermarketLocation");
  const methodEnd = realDataSourceSource.indexOf("\n  }", methodStart);
  const methodBody = realDataSourceSource.slice(methodStart, methodEnd);
  assertStringIncludes(methodBody, "l.id === id");
  assertEquals(methodBody.includes("campaign_id"), false);
});
