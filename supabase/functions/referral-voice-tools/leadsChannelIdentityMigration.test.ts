import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../../migrations/20260729000300_fix_leads_channel_identity_uniqueness.sql",
    import.meta.url,
  ),
);

const normalizedSql = sql.trim().replace(/\s+/g, " ").toLowerCase();

Deno.test("lead identity migration drops only the conflicting legacy index", () => {
  assertEquals(
    normalizedSql,
    "drop index if exists public.leads_org_channel_unique;",
  );
});

Deno.test("channel-aware lead identity objects remain untouched", () => {
  for (
    const preservedName of [
      "leads_org_channel_user_unique",
      "leads_org_channel_user_uniq",
      "leads_org_channel_user_uidx",
    ]
  ) {
    assert(!normalizedSql.includes(preservedName));
  }

  const identityKey = (
    organizationId: string,
    channel: "voice" | "whatsapp",
    channelUserId: string,
  ) => `${organizationId}:${channel}:${channelUserId}`;
  assertNotEquals(
    identityKey("luis-gabriel-referral-hub", "voice", "shared-user"),
    identityKey("luis-gabriel-referral-hub", "whatsapp", "shared-user"),
  );
});

Deno.test("lead identity migration cannot delete tables or data", () => {
  assert(!/\bdrop\s+table\b/i.test(sql));
  assert(!/\btruncate\b/i.test(sql));
  assert(!/\bdelete\s+from\b/i.test(sql));
  assert(!/\bupdate\b/i.test(sql));
  assert(!/\balter\s+table\b/i.test(sql));
});
