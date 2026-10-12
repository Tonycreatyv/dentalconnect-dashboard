/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const dashboard = await Deno.readTextFile(new URL("./PartnerDashboard.tsx", import.meta.url));
const styles = await Deno.readTextFile(new URL("../../index.css", import.meta.url));

Deno.test("Partner detail keeps Llamar before the compact Guardar gestión form", () => {
  const callIndex = dashboard.indexOf('className="partner-detail-call"');
  const managementIndex = dashboard.indexOf("GUARDAR GESTIÓN");
  assertEquals(callIndex > -1 && managementIndex > -1 && callIndex < managementIndex, true);
  assertStringIncludes(dashboard, "Resultado del contacto");
  assertStringIncludes(dashboard, "Número incorrecto");
  assertStringIncludes(dashboard, "Cerrar caso");
  assertStringIncludes(dashboard, "Guardar gestión");
});

Deno.test("call and WhatsApp links have no state mutation handlers", () => {
  assertStringIncludes(dashboard, 'href={telLink ?? "#"}');
  assertStringIncludes(dashboard, 'href={buildWhatsAppLink(phone) ?? "#"}');
  assertEquals(/onClick=\{\(event\) => \{[^}]*runManagement/.test(dashboard), false);
});

Deno.test("management follow-up requires explicit date and time and reuses durable fields", () => {
  assertStringIncludes(dashboard, 'id="partner-followup-date"');
  assertStringIncludes(dashboard, 'id="partner-followup-time"');
  assertStringIncludes(dashboard, 'p_follow_up_reason: step === "follow_up" ? followUpReason : null');
  assertStringIncludes(dashboard, 'p_next_followup_at: step === "follow_up" ? nextFollowupAt?.toISOString() ?? null : null');
});

Deno.test("Partner mobile uses the same compact filter state and keeps case cards", () => {
  assertStringIncludes(dashboard, 'className="partner-case-filterbar"');
  assertStringIncludes(dashboard, 'className="partner-status-tabs"');
  assertStringIncludes(dashboard, '["disqualified", "No calificó"]');
  assertStringIncludes(dashboard, "Más filtros");
  assertStringIncludes(dashboard, 'aria-label="Elegir fecha exacta"');
  assertStringIncludes(dashboard, 'className="partner-list partner-mobile-cards"');
  assertStringIncludes(styles, ".partner-mobile-cards{display:grid}");
});

Deno.test("Partner desktop operation rail stays sticky and secondary details remain collapsible", () => {
  assertStringIncludes(styles, ".partner-detail-col-side{position:sticky;top:84px}");
  assertStringIncludes(dashboard, '<details className="partner-more-information">');
});
