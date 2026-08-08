import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";

const migrationUrl = new URL(
  "../../migrations/20260728000100_lg_service_catalog_rehome.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationUrl);

const ids = [
  "luis_accidente",
  "luis_inmigracion",
  "luis_cupon_medico",
  "luis_cupon_super",
  "luis_cupon_dental",
  "luis_eventos",
  "luis_donacion",
  "luis_representante",
];

Deno.test("migration re-homes seven global IDs and inserts dental without key changes", () => {
  assert(sql.includes("update public.service_configs as service"));
  assert(sql.includes("service.organization_id = 'insurance-demo'"));
  assert(sql.includes("organization_id = 'luis-gabriel-referral-hub'"));
  assert(sql.includes("insert into public.service_configs"));
  assert(sql.includes("'luis_cupon_dental'"));
  assert(!/\bupdate\s+public\.leads\b/i.test(sql));
  assert(!/\balter\s+table\b/i.test(sql));
  assert(!/\bdrop\s+(constraint|table|index)\b/i.test(sql));
});

Deno.test("migration guards seven-row source and exact eight-row destination", () => {
  assert(sql.includes("v_legacy_count <> 7"));
  assert(sql.includes("v_conflict_count <> 0"));
  assert(sql.includes("v_canonical_count <> 8"));
  assert(!sql.includes("v_active_tenant_count"));
  assert(!sql.includes("lg_service_rehome_unexpected_active_service"));
  assert(sql.includes("lg_service_rehome_legacy_rows_remain"));
  for (const id of ids) assert(sql.includes(`'${id}'`));
  assertEquals(new Set(ids).size, 8);
});

Deno.test("dental uses safe required coupon-row structure", () => {
  assert(sql.includes("'static_action'"));
  assert(sql.includes("'[]'::jsonb"));
  assert(sql.includes("'🦷'"));
  assert(!sql.includes("Cupón $20"));
  assert(!sql.includes("Donación de comida"));
  assert(!sql.includes("Hablar con alguien"));
});

Deno.test("migration preserves lead foreign-key values and coupon terms", () => {
  assert(!/\bset\s+id\s*=/i.test(sql));
  assert(!/referral_coupon_campaigns\s+(set|delete|insert|update)/i.test(sql));
  assert(!/delete\s+from\s+public\.service_configs/i.test(sql));
  assert(sql.includes("Coupon commercial terms"));
});
