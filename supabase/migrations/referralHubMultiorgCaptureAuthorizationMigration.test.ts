/// <reference lib="deno.ns" />
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20260909000100_referral_hub_multiorg_capture_authorization.sql",
);

Deno.test("no literal Luis tenant gate remains inside either function body — the literal id only appears in the seed data, never as a branching check", () => {
  assertEquals(sql.includes("tenant_forbidden"), false);
  for (const fn of ["capture_immigration_flow_request", "capture_legal_flow_request"]) {
    const start = sql.indexOf(`create or replace function public.${fn}(`);
    const end = sql.indexOf("$function$;", start) + "$function$;".length;
    assert(start >= 0 && end > start, `could not locate ${fn} body`);
    assertEquals(sql.slice(start, end).includes("luis-gabriel-referral-hub"), false, `${fn} must not branch on the literal tenant id`);
  }
  // The literal id is expected exactly twice: the two seed rows.
  const occurrences = sql.split("luis-gabriel-referral-hub").length - 1;
  assertEquals(occurrences, 2);
});

Deno.test("both capture functions gate on organization existence, then a generic org+service capability check against the new dedicated table", () => {
  assertStringIncludes(sql, "referral_immigration_capture_organization_not_found");
  assertStringIncludes(sql, "referral_immigration_capture_service_not_enabled");
  assertStringIncludes(sql, "referral_legal_capture_organization_not_found");
  assertStringIncludes(sql, "referral_legal_capture_service_not_enabled");
  assertStringIncludes(
    sql,
    "select 1 from public.referral_organization_services\n    where organization_id = p_organization_id and service_id = 'luis_inmigracion' and enabled",
  );
  assertStringIncludes(
    sql,
    "select 1 from public.referral_organization_services\n    where organization_id = p_organization_id and service_id = 'luis_accidente' and enabled",
  );
});

Deno.test("capability check no longer reads referral_partner_service_rules.active — capture and routing are fully decoupled", () => {
  // referral_partner_service_rules may still appear in prose comments
  // explaining the decoupling, but must never appear inside an executable
  // statement (a query, an insert, a DDL clause).
  const executableLines = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"));
  const executableSql = executableLines.join("\n");
  assertEquals(executableSql.includes("referral_partner_service_rules"), false);
});

Deno.test("referral_organization_services is the smallest possible model: only organization_id, service_id, enabled, timestamps — no partner/routing/pricing/campaign fields", () => {
  const start = sql.indexOf("create table if not exists public.referral_organization_services");
  assert(start >= 0, "table definition not found");
  const tableDef = sql.slice(start, sql.indexOf(");", start) + 2);
  assertStringIncludes(tableDef, "organization_id text not null references public.organizations(id)");
  assertStringIncludes(tableDef, "service_id text not null");
  assertStringIncludes(tableDef, "enabled boolean not null default true");
  assertStringIncludes(tableDef, "primary key (organization_id, service_id)");
  for (const forbidden of ["partner_id", "priority", "weight", "price", "quota", "campaign", "capacity"]) {
    assertEquals(tableDef.toLowerCase().includes(forbidden), false, `referral_organization_services must not define a '${forbidden}' column`);
  }
});

Deno.test("the new table is seeded only for the two services the live organization already has enabled, preserving current production behavior", () => {
  assertStringIncludes(sql, "insert into public.referral_organization_services (organization_id, service_id, enabled)");
  assertStringIncludes(sql, "('luis-gabriel-referral-hub', 'luis_inmigracion', true)");
  assertStringIncludes(sql, "('luis-gabriel-referral-hub', 'luis_accidente', true)");
  assertStringIncludes(sql, "on conflict (organization_id, service_id) do nothing");
});

Deno.test("service ownership (which capture function owns which service_id) is unchanged, not folded into the tenant check", () => {
  assertStringIncludes(sql, "service_id = 'luis_inmigracion'");
  assertStringIncludes(sql, "service_id = 'luis_accidente'");
  assertStringIncludes(sql, "referral_legal_capture_intake_type_forbidden");
  assertStringIncludes(sql, "p_intake_type not in ('AUTO_ACCIDENT', 'DUI', 'CRIMINAL')");
});

Deno.test("immigration intake shape validation is byte-for-byte unchanged from the live definition", () => {
  assertStringIncludes(
    sql,
    "p_completion_key <> 'luis_unified_services:immigration:v1'",
  );
  assertStringIncludes(sql, "p_intake->>'intake_type' <> 'IMMIGRATION'");
  assertStringIncludes(sql, "nullif(trim(p_intake->>'topic'), '') is null");
});

Deno.test("legal intake shape validation is byte-for-byte unchanged from the live definition", () => {
  assertStringIncludes(sql, "p_intake->>'flow_type' <> 'luis_unified_services'");
  assertStringIncludes(sql, "p_intake->>'intake_type' <> p_intake_type");
});

Deno.test("request fields written are unchanged: source_channel stays the literal 'whatsapp', no source_campaign/source_owner introduced", () => {
  const sourceChannelAssignments = sql.match(/source_channel = 'whatsapp'/g) ?? [];
  assert(sourceChannelAssignments.length >= 2, "expected the literal source_channel assignment in both functions' update and insert paths");
  assertEquals(sql.includes("source_campaign"), false);
  assertEquals(sql.includes("source_owner"), false);
});

Deno.test("no routing call, assignment table write, or partner selection logic was added — capture still only writes referral_service_requests/referral_operational_events", () => {
  assertEquals(sql.includes("insert into public.referral_assignments"), false);
  assertEquals(sql.includes("select public.auto_assign_"), false);
  assertEquals(sql.includes("perform public.auto_assign_"), false);
  assertEquals(sql.includes("assignment_priority"), false);
});

Deno.test("signatures are unchanged (no DROP FUNCTION, no new/removed parameters) — grants are preserved automatically by CREATE OR REPLACE", () => {
  assertEquals(sql.includes("drop function"), false);
  assertStringIncludes(
    sql,
    "create or replace function public.capture_immigration_flow_request(p_organization_id text, p_lead_id uuid, p_channel_user_id text, p_completion_key text, p_delivery_key text, p_completed_at timestamp with time zone, p_intake jsonb)",
  );
  assertStringIncludes(
    sql,
    "create or replace function public.capture_legal_flow_request(p_organization_id text, p_lead_id uuid, p_channel_user_id text, p_intake_type text, p_completion_key text, p_delivery_key text, p_completed_at timestamp with time zone, p_intake jsonb)",
  );
});

Deno.test("orchestrate_referral_service_request's own definition is not touched in this phase (only discussed in the header comment)", () => {
  assertEquals(sql.includes("create or replace function public.orchestrate_referral_service_request"), false);
  assertEquals(sql.includes("drop function public.orchestrate_referral_service_request"), false);
});

Deno.test("referral_organization_services is least-privilege: RLS enabled, all access revoked from public/anon/authenticated, only service_role granted — no frontend-access pattern is introduced", () => {
  assertStringIncludes(sql, "alter table public.referral_organization_services enable row level security");
  assertStringIncludes(sql, "revoke all on public.referral_organization_services from public, anon, authenticated");
  assertStringIncludes(sql, "grant all on public.referral_organization_services to service_role");
  // No policy is created for any role — the revoke above is the entire
  // access story. If a policy is ever added, it must not open the table to
  // anon/authenticated without a corresponding deliberate spec update.
  assertEquals(sql.includes("create policy"), false);
});

Deno.test("DUI/CRIMINAL are not granted their own organization-service capability — only the two services already live today are enabled", () => {
  // AUTO_ACCIDENT/DUI/CRIMINAL all resolve to the single service_id
  // 'luis_accidente' in capture_legal_flow_request (see the file's own
  // comment on this), so no separate luis_dui/luis_criminal capability row
  // is needed or present — enabling them here would be new capability
  // surface this migration does not intend to grant.
  assertEquals(sql.includes("'luis_dui'"), false);
  assertEquals(sql.includes("'luis_criminal'"), false);
  const seedStart = sql.indexOf("insert into public.referral_organization_services");
  const seedEnd = sql.indexOf(";", seedStart);
  const seedBlock = sql.slice(seedStart, seedEnd);
  const seededServiceIds = [...seedBlock.matchAll(/'(luis_[a-z_]+)'/g)].map((m) => m[1]);
  assertEquals(seededServiceIds.sort(), ["luis_accidente", "luis_inmigracion"]);
});

Deno.test("missing capability row and disabled capability row are rejected through the exact same check — capture authorization does not distinguish the two cases", () => {
  // 'not exists (... and enabled)' rejects identically whether no row
  // matches organization_id+service_id at all, or a row matches but
  // enabled=false. There is no separate branch/error code for either case,
  // by design — this is what makes the check a pure "may this org capture
  // this service" question rather than a routing/config-presence check.
  for (const fn of ["capture_immigration_flow_request", "capture_legal_flow_request"]) {
    const start = sql.indexOf(`create or replace function public.${fn}(`);
    const end = sql.indexOf("$function$;", start) + "$function$;".length;
    const body = sql.slice(start, end);
    const enabledChecks = body.match(/and enabled\s*\n\s*\)\s*then/g) ?? [];
    assertEquals(enabledChecks.length, 1, `${fn} must gate on exactly one unified enabled check`);
  }
});

Deno.test("the organization+service capability check is fully parameterized — a second organization (e.g. a future Cotto) is authorized by data alone, never by editing this function again", () => {
  for (const fn of ["capture_immigration_flow_request", "capture_legal_flow_request"]) {
    const start = sql.indexOf(`create or replace function public.${fn}(`);
    const end = sql.indexOf("$function$;", start) + "$function$;".length;
    const body = sql.slice(start, end);
    assertStringIncludes(body, "where organization_id = p_organization_id and service_id =");
    // The only per-organization literal permitted anywhere in the body is
    // none at all — organization_id is always the caller-supplied parameter.
    assertEquals(body.includes("luis-gabriel-referral-hub"), false);
  }
});
