/// <reference lib="deno.ns" />
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./useImmigrationInbox.ts", import.meta.url));

Deno.test("Admin Operacion reads only current assignment lifecycles as the responsible assignment", () => {
  assertStringIncludes(source, '.in("status", ["pending_assignment", "assigned", "accepted"])');
});

Deno.test("Admin Operacion scopes both requests and assignments to the resolved organization", () => {
  const matches = source.match(/\.eq\("organization_id", resolvedOrgId\)/g) ?? [];
  if (matches.length < 2) throw new Error("request and assignment queries must both be organization-scoped");
});
