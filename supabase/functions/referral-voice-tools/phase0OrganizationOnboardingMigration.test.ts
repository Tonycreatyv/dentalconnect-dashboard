import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(new URL(
  "../../migrations/20260902000100_secure_organization_onboarding.sql",
  import.meta.url,
));
const onboarding = await Deno.readTextFile(new URL(
  "../../../src/pages/Onboarding.tsx",
  import.meta.url,
));
const register = await Deno.readTextFile(new URL(
  "../../../src/pages/Register.tsx",
  import.meta.url,
));

Deno.test("Phase 0 makes tenant creation server-owned and idempotent", () => {
  assertStringIncludes(sql, "create table if not exists public.organization_onboarding_requests");
  assertStringIncludes(sql, "onboarding_request_id uuid primary key");
  assertStringIncludes(sql, "create or replace function public.create_organization_with_owner");
  assertStringIncludes(sql, "v_user_id uuid := auth.uid()");
  assertStringIncludes(sql, "onboarding_request_forbidden");
  assertStringIncludes(sql, "insert into public.organizations");
  assertStringIncludes(sql, "insert into public.org_members");
  assertStringIncludes(sql, "drop trigger if exists on_auth_user_created on auth.users");
  assertStringIncludes(sql, "set search_path=public,pg_temp");
});

Deno.test("Phase 0 removes direct browser membership and organization creation", () => {
  assertStringIncludes(sql, "revoke insert, update, delete on table public.org_members from public, anon, authenticated");
  assertStringIncludes(sql, "revoke insert on table public.organizations from public, anon, authenticated");
  assertStringIncludes(onboarding, 'supabase.rpc("create_organization_with_owner"');
  assert(!onboarding.includes('.from("org_members").upsert'));
  assert(!onboarding.includes('.from("organizations").insert'));
});

Deno.test("legacy register cannot write clinic-demo and redirects to signup", () => {
  assertStringIncludes(register, "<Navigate replace");
  assertStringIncludes(register, "/signup");
  assert(!register.includes("clinic-demo"));
  assert(!register.includes("persistOnboarding"));
});
