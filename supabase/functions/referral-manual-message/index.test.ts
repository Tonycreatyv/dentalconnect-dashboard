import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("manual messages require membership and never return provider sent at enqueue", () => {
  assertStringIncludes(source, '.from("org_members")');
  assertStringIncludes(source, '["owner", "admin"]');
  assert(!source.includes('"operator"'));
  assertStringIncludes(source, 'delivery_status: "queued"');
  assert(!source.includes('delivery_status: "sent"'));
});
Deno.test("manual messages are tenant, channel and idempotency scoped", () => {
  assertStringIncludes(source, "LG_ORGANIZATION_ID");
  assertStringIncludes(source, "includes(channel)");
  assertStringIncludes(source, "idempotency_key");
  assertStringIncludes(source, 'source: "manual_staff_reply"');
});
