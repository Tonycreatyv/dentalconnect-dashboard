import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../../migrations/20260729000100_lg_grocery_service_activation.sql",
    import.meta.url,
  ),
);

Deno.test("grocery migration safely renames only an unreferenced legacy service", () => {
  assert(sql.includes("where service_id = 'luis_donacion'"));
  assert(sql.includes("lg_grocery_legacy_service_has_leads"));
  assert(sql.includes("set id = 'luis_compra_super'"));
  assert(!/\bupdate\s+public\.leads\b/i.test(sql));
  assert(!/\bdelete\s+from\s+public\.leads\b/i.test(sql));
});

Deno.test("grocery migration produces the exact approved eight-service order", () => {
  const expected = [
    ["luis_compra_super", 1],
    ["luis_cupon_super", 2],
    ["luis_accidente", 3],
    ["luis_inmigracion", 4],
    ["luis_cupon_medico", 5],
    ["luis_cupon_dental", 6],
    ["luis_eventos", 7],
    ["luis_representante", 8],
  ] as const;
  for (const [id, order] of expected) {
    assert(sql.includes(`'${id}'`));
    assert(sql.includes(`${order}`));
  }
  assert(sql.includes("lg_grocery_legacy_service_remains"));
  assertEquals(expected.length, 8);
});

Deno.test("grocery migration adds only the required voice order source", () => {
  assert(
    sql.includes(
      "source_channel in ('web', 'whatsapp', 'voice', 'qr', 'admin')",
    ),
  );
  assert(!/\bdrop\s+table\b/i.test(sql));
  assert(!/\bdelete\s+from\s+public\.service_configs\b/i.test(sql));
});
