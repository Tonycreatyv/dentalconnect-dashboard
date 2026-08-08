import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const operational = await Deno.readTextFile(
  new URL(
    "../../migrations/20260801000100_referral_operations_pilot.sql",
    import.meta.url,
  ),
);
const hardening = await Deno.readTextFile(
  new URL(
    "../../migrations/20260801000200_referral_legacy_rls_hardening.sql",
    import.meta.url,
  ),
);
const portal = await Deno.readTextFile(
  new URL("../referral-partner-portal/index.ts", import.meta.url),
);

Deno.test("new operational policies never grant public or anon access", () => {
  const policies = [...operational.matchAll(/create policy[^;]+;/gi)].map(
    (match) => match[0],
  );
  assert(policies.length > 0);
  assert(policies.every((policy) => !/\bto\s+(public|anon)\b/i.test(policy)));
  assertStringIncludes(
    operational,
    "revoke all on table public.%I from public,anon,authenticated",
  );
  assertStringIncludes(operational, "to authenticated");
});

Deno.test("operational reads and mutations require current owner or admin membership", () => {
  assertStringIncludes(operational, "auth.uid() is null");
  assertStringIncludes(operational, "array['owner','admin']");
  assert(!operational.includes("array['owner','admin','operator']"));
  assertStringIncludes(
    operational,
    "where id=p_request_id and organization_id=p_organization_id",
  );
  assertStringIncludes(
    operational,
    "where id=p_exception_id and organization_id=p_organization_id",
  );
});

Deno.test("tenant partner and location relationships are enforced", () => {
  assertStringIncludes(
    operational,
    "foreign key(organization_id,partner_id) references public.referral_partners(organization_id,id)",
  );
  assertStringIncludes(operational, "partner_location_scope_mismatch");
  assertStringIncludes(
    operational,
    "l.organization_id=new.organization_id and l.partner_id=new.partner_id",
  );
  assertStringIncludes(
    operational,
    "referral_validate_operational_tenant_scope",
  );
  assertStringIncludes(
    operational,
    "l.id=new.lead_id and l.organization_id=new.organization_id",
  );
  assertStringIncludes(
    operational,
    "r.id=new.request_id and r.organization_id=new.organization_id",
  );
  assertStringIncludes(
    operational,
    "a.id=new.assignment_id and a.organization_id=new.organization_id",
  );
  assertStringIncludes(
    operational,
    "c.organization_id=new.organization_id and c.partner_id=new.partner_id",
  );
});

Deno.test("legacy membership self-creation is replaced conservatively", () => {
  assertStringIncludes(
    hardening,
    "drop policy if exists org_members_insert on public.org_members",
  );
  assertStringIncludes(hardening, "org_members_insert_owner_admin");
  assertStringIncludes(hardening, "public.referral_is_member");
  assertStringIncludes(hardening, "array['owner', 'admin']");
  assert(!/drop policy[^;]+on public\.(leads|messages)/i.test(hardening));
});

Deno.test("partner tokens remain assignment and partner scoped", () => {
  assertStringIncludes(portal, '.eq("token_hash",await hash(token))');
  assertStringIncludes(portal, '.eq("id",access.assignment_id)');
  assertStringIncludes(portal, '.eq("partner_id",access.partner_id)');
  assert(!portal.includes('from("org_members")'));
});

Deno.test("legacy hardening drops only the exact confirmed membership policy", () => {
  const droppedPolicies = [
    ...hardening.matchAll(/drop policy if exists\s+([^\s]+)\s+on\s+([^;]+);/gi),
  ];
  assert(droppedPolicies.length === 1);
  assert(droppedPolicies[0][1] === "org_members_insert");
  assert(droppedPolicies[0][2].trim() === "public.org_members");
  assert(
    !/\b(alter|drop|truncate)\s+table\s+public\.(leads|messages)/i.test(
      hardening,
    ),
  );
});
