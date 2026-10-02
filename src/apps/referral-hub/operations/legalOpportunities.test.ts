/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { legalOpportunityPresentation, matchesOpportunityServiceFilter } from "./legalOpportunities.ts";

Deno.test("admin opportunity resolver recognizes production shared and future canonical legal IDs", () => {
  const cases = [
    ["luis_inmigracion", { topic: "FAMILY_GREEN_CARD", petitioner_relationship: "SPOUSE_US_CITIZEN", entry_method: "VISA", prior_uscis_petition: "NO", description: "Ayuda." }, "immigration", "Inmigración"],
    ["luis_accidente", { intake_type: "AUTO_ACCIDENT", received_medical_attention: "YES", police_report: "YES", description: "Choque." }, "auto_accident", "Accidente de auto"],
    ["luis_accidente", { intake_type: "DUI", chemical_test: "YES", court_date_status: "COURT_DATE_SET", description: "DUI." }, "dui", "DUI"],
    ["luis_accidente", { intake_type: "CRIMINAL", currently_detained: "NO", court_date_status: "COURT_DATE_SET", description: "Cargo." }, "criminal", "Criminal"],
    ["luis_dui", { description: "DUI." }, "dui", "DUI"],
    ["luis_criminal", { description: "Cargo." }, "criminal", "Criminal"],
  ] as const;
  for (const [id, intake, service, label] of cases) {
    const topic = (intake as Record<string, unknown>).topic;
    const view = legalOpportunityPresentation(id, intake, typeof topic === "string" ? topic : null);
    assertEquals(view.service, service);
    assertEquals(view.serviceLabel, label);
    assertEquals(matchesOpportunityServiceFilter(id, intake, service), true);
  }
});

Deno.test("distinct requests for the same lead are independently matchable", () => {
  assertEquals(matchesOpportunityServiceFilter("luis_accidente", { intake_type: "AUTO_ACCIDENT" }, "auto_accident"), true);
  assertEquals(matchesOpportunityServiceFilter("luis_accidente", { intake_type: "DUI" }, "dui"), true);
});
