/// <reference lib="deno.ns" />
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPartnerCsv, buildPartnerXlsx, type PartnerExportRow } from "./partnerExport.ts";

const rows: PartnerExportRow[] = [{
  estado: "Nuevo",
  cliente: "=2+2",
  servicio: "Accidente de auto",
  telefono: "4045551212",
  zip: "30043",
  recibido: "4 oct 2026 · 2:14 p. m.",
  antiguedad: "2 h",
  proximoSeguimiento: "—",
}];

Deno.test("buildPartnerCsv emits UTF-8 BOM, quoted cells and blocks spreadsheet formulas", () => {
  const csv = buildPartnerCsv(rows);
  assert(csv.startsWith("\uFEFF"));
  assertStringIncludes(csv, '"Estado","Cliente","Servicio"');
  assertStringIncludes(csv, '"\'=2+2"');
});

Deno.test("buildPartnerXlsx emits a real OOXML ZIP package", () => {
  const xlsx = buildPartnerXlsx(rows);
  assertEquals(Array.from(xlsx.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  const binaryText = new TextDecoder().decode(xlsx);
  assertStringIncludes(binaryText, "[Content_Types].xml");
  assertStringIncludes(binaryText, "_rels/.rels");
  assertStringIncludes(binaryText, "xl/workbook.xml");
  assertStringIncludes(binaryText, "xl/_rels/workbook.xml.rels");
  assertStringIncludes(binaryText, "xl/worksheets/sheet1.xml");
  assertStringIncludes(binaryText, "Mi trabajo");
  assertStringIncludes(binaryText, "&apos;=2+2");
  assertStringIncludes(binaryText, "PK\u0005\u0006");
});
