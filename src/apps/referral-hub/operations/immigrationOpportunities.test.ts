/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveImmigrationOpportunity } from "./immigrationOpportunities.ts";

const request = { id:"r", leadId:"l", leadName:"Ana Pérez", channelUserId:null, topic:"GREEN_CARD", description:"Residencia", postalCode:"30000", consentStatus:"authorized" as const, consentVersion:null, consentCapturedAt:null, intakeComplete:true, status:"prequalified", caseCycle:1, createdAt:"2026-01-01T00:00:00Z" };

Deno.test("immigration opportunity keeps assignment state separate from the client stage", () => {
  const opportunity = resolveImmigrationOpportunity(request, { id:"a", status:"accepted", workStatus:"contacted", assignedAt:"2026-01-01T01:00:00Z", updatedAt:"2026-01-01T02:00:00Z", partnerName:"Bufete A" });
  assertEquals(opportunity.operationalStatus, "Contactado");
  assertEquals(opportunity.recommendedAction, "Esperar respuesta o registrar cita");
});

Deno.test("authorized unassigned immigration request is visible as an assignment exception", () => {
  const opportunity = resolveImmigrationOpportunity(request, null);
  assertEquals(opportunity.operationalStatus, "Sin aliado disponible");
});
