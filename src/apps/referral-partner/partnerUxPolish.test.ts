/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const dashboard = await Deno.readTextFile(new URL("./PartnerDashboard.tsx", import.meta.url));
const styles = await Deno.readTextFile(new URL("../../index.css", import.meta.url));

Deno.test("Partner detail keeps Llamar before Resultado de la llamada", () => {
  const callIndex = dashboard.indexOf('className="partner-detail-call"');
  const resultIndex = dashboard.indexOf("Resultado de la llamada");
  assertEquals(callIndex > -1 && resultIndex > -1 && callIndex < resultIndex, true);
  assertStringIncludes(dashboard, "Registrá qué pasó después de contactar al cliente.");
});

Deno.test("Partner mobile status filtering uses a compact select instead of overflowing chips", () => {
  assertStringIncludes(dashboard, 'className="partner-mobile-filter"');
  assertStringIncludes(dashboard, '<option value="disqualified">No calificó</option>');
  assertStringIncludes(styles, "@media(max-width:639px){.partner-service-filter{display:none}");
});

Deno.test("Partner desktop operation rail stays sticky and secondary details remain collapsible", () => {
  assertStringIncludes(styles, ".partner-detail-col-side{position:sticky;top:84px}");
  assertStringIncludes(dashboard, '<details className="partner-more-information">');
});
