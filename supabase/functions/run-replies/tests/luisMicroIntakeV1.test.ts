// Regression coverage for the Luis micro-intake V1 implementation: new
// immigration topics, new AUTO_ACCIDENT/DUI/CRIMINAL structured fields and
// consent, and the new captureLegalFlowRequest capture+assign bridge.
// Backward compatibility with every pre-V1 stored payload shape is the
// primary thing under test here — nothing here may ever start rejecting an
// old completion that used to parse.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLuisLegalFlowCompletion } from "../../_products/referral-hub/luisBenefits.ts";
import { captureLegalFlowRequest, LEGAL_SERVICE_ID_BY_INTAKE_TYPE } from "../domain/referralHub/legalFlowRequest.ts";
import { captureImmigrationFlowRequest } from "../domain/referralHub/immigrationFlowRequest.ts";

// --- IMMIGRATION: new topics + backward compatibility --------------------

Deno.test("every new V1 immigration topic parses with its own structured fields", () => {
  const citizenship = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION", topic: "CITIZENSHIP", full_name: "Ana", postal_code: "30071",
    description: "Quiero aplicar a la ciudadanía.",
    resident_duration: "MORE_THAN_5_YEARS", long_absence: "NO", citizenship_marriage_basis: "NOT_SURE",
    sharing_consent: "AUTHORIZED",
  });
  assert(citizenship?.intake_type === "IMMIGRATION");
  assertEquals(citizenship.resident_duration, "MORE_THAN_5_YEARS");
  assertEquals(citizenship.long_absence, "NO");
  assertEquals(citizenship.citizenship_marriage_basis, "NOT_SURE");

  const familyGc = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION", topic: "FAMILY_GREEN_CARD", full_name: "Ana", postal_code: "30071",
    description: "Mi esposa me quiere pedir.",
    petitioner_relationship: "US_CITIZEN_SPOUSE", entry_method: "VISA", prior_uscis_petition: "NO",
  });
  assert(familyGc?.intake_type === "IMMIGRATION");
  assertEquals(familyGc.petitioner_relationship, "US_CITIZEN_SPOUSE");
  assertEquals(familyGc.entry_method, "VISA");
  assertEquals(familyGc.prior_uscis_petition, "NO");

  const gcRenewal = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION", topic: "GREEN_CARD_RENEWAL", full_name: "Ana", postal_code: "30071",
    description: "Se me vence la tarjeta.",
    green_card_term: "TEN_YEAR", green_card_issue: "EXPIRING", prior_related_filing: "NO",
  });
  assert(gcRenewal?.intake_type === "IMMIGRATION");
  assertEquals(gcRenewal.green_card_term, "TEN_YEAR");
  assertEquals(gcRenewal.green_card_issue, "EXPIRING");

  const asylum = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION", topic: "ASYLUM", full_name: "Ana", postal_code: "30071",
    description: "Busco protección.",
    arrival_window: "LESS_THAN_ONE_YEAR", fear_reason: "POLITICAL", immigration_court_status: "NO",
  });
  assert(asylum?.intake_type === "IMMIGRATION");
  assertEquals(asylum.arrival_window, "LESS_THAN_ONE_YEAR");
  assertEquals(asylum.fear_reason, "POLITICAL");

  const uVisa = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION", topic: "U_VISA", full_name: "Ana", postal_code: "30071",
    description: "Fui víctima de un robo.",
    crime_victim: "YES", police_report: "YES", law_enforcement_cooperation: "YES",
  });
  assert(uVisa?.intake_type === "IMMIGRATION");
  assertEquals(uVisa.crime_victim, "YES");
  assertEquals(uVisa.police_report, "YES");

  const workPermit = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION", topic: "WORK_PERMIT", full_name: "Ana", postal_code: "30071",
    description: "Se me vence el permiso.",
    work_permit_request_type: "RENEWAL", work_permit_basis: "ASYLUM", work_permit_status: "EXPIRING",
  });
  assert(workPermit?.intake_type === "IMMIGRATION");
  assertEquals(workPermit.work_permit_request_type, "RENEWAL");
  assertEquals(workPermit.work_permit_status, "EXPIRING");
});

Deno.test("old GREEN_CARD/FAMILY_PETITION/CONSULTATION/IMMIGRATION_COURT topic values still parse, unchanged", () => {
  for (const topic of ["GREEN_CARD", "FAMILY_PETITION", "CONSULTATION", "IMMIGRATION_COURT"]) {
    const result = parseLuisLegalFlowCompletion({
      intake_type: "IMMIGRATION", topic, full_name: "Ana", postal_code: "30071", description: "Necesito ayuda.",
    });
    assertEquals(result?.intake_type, "IMMIGRATION");
    assert(result && "topic" in result && result.topic === topic, `topic ${topic} must still parse`);
  }
});

Deno.test("a V1 immigration completion missing every new structured field still parses (all optional fields null)", () => {
  const result = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION", topic: "OTHER", full_name: "Ana", postal_code: "30071", description: "Consulta general.",
  });
  assert(result?.intake_type === "IMMIGRATION");
  assertEquals(result.resident_duration, null);
  assertEquals(result.petitioner_relationship, null);
  assertEquals(result.work_permit_status, null);
});

// --- AUTO_ACCIDENT ---------------------------------------------------------

Deno.test("AUTO_ACCIDENT parses the new police_report field and sharing_consent", () => {
  const result = parseLuisLegalFlowCompletion({
    intake_type: "AUTO_ACCIDENT", full_name: "Ana", accident_date: "2026-08-20",
    received_medical_attention: "YES", police_report: "YES", description: "Me chocaron.",
    sharing_consent: "AUTHORIZED", consent_version: "luis_legal_sharing_v1", consent_source: "whatsapp_flow",
  });
  assert(result?.intake_type === "AUTO_ACCIDENT");
  assertEquals(result.police_report, "YES");
  assertEquals(result.sharing_consent, "AUTHORIZED");
});

Deno.test("AUTO_ACCIDENT: old payloads with participation/medical_provider and no consent still parse", () => {
  const result = parseLuisLegalFlowCompletion({
    intake_type: "AUTO_ACCIDENT", full_name: "Ana", accident_date: "2026-08-14",
    participation: "DRIVER", received_medical_attention: "YES", medical_provider: "Clínica local",
    description: "Choque leve.",
  });
  assert(result?.intake_type === "AUTO_ACCIDENT");
  assertEquals(result.participant_role, "DRIVER");
  assertEquals(result.medical_provider, "Clínica local");
  assertEquals(result.police_report, null);
  // No sharing_consent key on this legacy-shaped payload — must default to
  // PENDING exactly like IMMIGRATION's own fallback, never fail to parse.
  assertEquals(result.sharing_consent, "PENDING");
});

Deno.test("AUTO_ACCIDENT: missing participant_role/medical_provider entirely (the new V1 UI shape) still parses", () => {
  const result = parseLuisLegalFlowCompletion({
    intake_type: "AUTO_ACCIDENT", full_name: "Ana", accident_date: "2026-08-20",
    received_medical_attention: "NO", police_report: "NOT_SURE", description: "Accidente menor.",
    sharing_consent: "DECLINED",
  });
  assert(result?.intake_type === "AUTO_ACCIDENT");
  assertEquals(result.participant_role, null);
  assertEquals(result.medical_provider, null);
  assertEquals(result.sharing_consent, "DECLINED");
});

// --- DUI vs CRIMINAL: distinguishable, own structured fields --------------

Deno.test("DUI parses its own structured fields, distinct intake_type from CRIMINAL", () => {
  const result = parseLuisLegalFlowCompletion({
    intake_type: "DUI", full_name: "Ana", postal_code: "30071",
    dui_date: "2026-08-21", chemical_test: "COMPLETED", court_date_status: "NO",
    description: "Me detuvieron en un retén.", sharing_consent: "AUTHORIZED",
  });
  assert(result?.intake_type === "DUI");
  assertEquals(result.chemical_test, "COMPLETED");
  assertEquals(result.court_date_status, "NO");
  assertEquals(result.dui_date, "2026-08-21");
});

Deno.test("CRIMINAL parses its own structured fields, distinct intake_type from DUI", () => {
  const result = parseLuisLegalFlowCompletion({
    intake_type: "CRIMINAL", full_name: "Ana", postal_code: "30071",
    criminal_charge: "Cargo por hurto", court_date_status: "NOT_SURE", currently_detained: "NO",
    description: "Me acusan de algo que no hice.", sharing_consent: "AUTHORIZED",
  });
  assert(result?.intake_type === "CRIMINAL");
  assertEquals(result.criminal_charge, "Cargo por hurto");
  assertEquals(result.currently_detained, "NO");
  // Never confusable with DUI's shape — no chemical_test/dui_date field exists on CRIMINAL's type at all.
  assert(!("chemical_test" in result));
});

Deno.test("legacy DUI_CRIMINAL completions (pre-V1) still parse exactly as before — no consent, no new fields", () => {
  const result = parseLuisLegalFlowCompletion({
    intake_type: "DUI_CRIMINAL", topic: "ARREST", full_name: "Ana", postal_code: null, description: "Me arrestaron.",
  });
  assertEquals(result, { intake_type: "DUI_CRIMINAL", topic: "ARREST", full_name: "Ana", postal_code: null, description: "Me arrestaron." });
});

// --- captureLegalFlowRequest: RPC wiring + consent gating -----------------

type RpcCall = { name: string; args: Record<string, unknown> };

function mockSupabase(responses: Record<string, unknown>) {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const response = responses[name];
      return Promise.resolve(
        response && typeof response === "object" && "error" in (response as object)
          ? response as { data: unknown; error: { message?: string } | null }
          : { data: response, error: null },
      );
    },
  };
}

Deno.test("captureLegalFlowRequest calls capture_legal_flow_request with the right intake_type-scoped completion_key, then auto_assign_legal_partner only when AUTHORIZED", async () => {
  const supabase = mockSupabase({
    capture_legal_flow_request: { success: true, request_id: "req-1", created: true, assigned: false, notification_created: false },
    auto_assign_legal_partner: { assigned: true, assignment_id: "assign-1" },
  });
  const result = await captureLegalFlowRequest({
    supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-1", channelUserId: "15550001111",
    deliveryKey: "delivery-1", intakeType: "DUI", completedAt: "2026-09-01T00:00:00.000Z",
    sharingConsent: "AUTHORIZED", consentVersion: "luis_legal_sharing_v1", consentSource: "whatsapp_flow",
    fields: { full_name: "Ana", dui_date: "2026-08-21", chemical_test: "COMPLETED", court_date_status: "NO", description: "Me detuvieron." },
  });
  assertEquals(result, { requestId: "req-1", created: true });
  assertEquals(supabase.calls.length, 2);
  assertEquals(supabase.calls[0].name, "capture_legal_flow_request");
  assertEquals(supabase.calls[0].args.p_intake_type, "DUI");
  assertEquals(supabase.calls[0].args.p_completion_key, "luis_unified_services:legal:dui:v1");
  assertEquals((supabase.calls[0].args.p_intake as Record<string, unknown>).service, "dui");
  assertEquals((supabase.calls[0].args.p_intake as Record<string, unknown>).intake_type, "DUI");
  assertEquals(supabase.calls[1].name, "auto_assign_legal_partner");
  assertEquals(supabase.calls[1].args.p_idempotency_key, "legal-partner:delivery-1");
});

Deno.test("captureLegalFlowRequest never calls auto_assign_legal_partner when consent is DECLINED", async () => {
  const supabase = mockSupabase({
    capture_legal_flow_request: { success: true, request_id: "req-2", created: true, assigned: false, notification_created: false },
  });
  await captureLegalFlowRequest({
    supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-2", channelUserId: "15550001111",
    deliveryKey: "delivery-2", intakeType: "CRIMINAL", completedAt: "2026-09-01T00:00:00.000Z",
    sharingConsent: "DECLINED",
    fields: { full_name: "Ana", criminal_charge: "Cargo por hurto", court_date_status: "NOT_SURE", currently_detained: "NO", description: "..." },
  });
  assertEquals(supabase.calls.length, 1);
  assertEquals(supabase.calls[0].name, "capture_legal_flow_request");
});

Deno.test("captureLegalFlowRequest never calls auto_assign_legal_partner when consent is absent/PENDING", async () => {
  const supabase = mockSupabase({
    capture_legal_flow_request: { success: true, request_id: "req-3", created: true, assigned: false, notification_created: false },
  });
  await captureLegalFlowRequest({
    supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-3", channelUserId: "15550001111",
    deliveryKey: "delivery-3", intakeType: "AUTO_ACCIDENT", completedAt: "2026-09-01T00:00:00.000Z",
    fields: { full_name: "Ana", accident_date: "2026-08-20", received_medical_attention: "YES", description: "..." },
  });
  assertEquals(supabase.calls.length, 1);
  assertEquals((supabase.calls[0].args.p_intake as Record<string, unknown>).sharing_consent, "PENDING");
});

Deno.test("captureLegalFlowRequest uses a distinct completion_key per intake_type, so accident/DUI/criminal never collide by construction", async () => {
  for (const [intakeType, expectedKey] of [
    ["AUTO_ACCIDENT", "luis_unified_services:legal:auto_accident:v1"],
    ["DUI", "luis_unified_services:legal:dui:v1"],
    ["CRIMINAL", "luis_unified_services:legal:criminal:v1"],
  ] as const) {
    const supabase = mockSupabase({
      capture_legal_flow_request: { success: true, request_id: `req-${intakeType}`, created: true, assigned: false, notification_created: false },
    });
    await captureLegalFlowRequest({
      supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-x", channelUserId: "15550001111",
      deliveryKey: `delivery-${intakeType}`, intakeType, completedAt: "2026-09-01T00:00:00.000Z",
      fields: { full_name: "Ana", description: "..." },
    });
    assertEquals(supabase.calls[0].args.p_completion_key, expectedKey);
  }
});

Deno.test("canonical legal mapping assigns a distinct case service to each legal intake type", () => {
  assertEquals(LEGAL_SERVICE_ID_BY_INTAKE_TYPE, {
    AUTO_ACCIDENT: "luis_accidente",
    DUI: "luis_dui",
    CRIMINAL: "luis_criminal",
  });
});

Deno.test("incremental legal split migration preserves one active case per canonical service and authorizes only the three legal services", async () => {
  const migration = await Deno.readTextFile(new URL("../../../migrations/20260906000100_split_legal_service_ids.sql", import.meta.url));
  assert(migration.includes("create or replace function public.resolve_legal_service_id"));
  assert(migration.includes("when 'DUI' then 'luis_dui'"));
  assert(migration.includes("when 'CRIMINAL' then 'luis_criminal'"));
  assert(migration.includes("service_id=legal_service_id"));
  assert(migration.includes("service_id in ('luis_accidente','luis_dui','luis_criminal')"));
  assert(migration.includes("('luis_dui'), ('luis_criminal')"));
});

Deno.test("captureLegalFlowRequest throws if capture_legal_flow_request returns an error or an invalid shape", async () => {
  const failing = mockSupabase({ capture_legal_flow_request: { data: null, error: { message: "boom" } } });
  await assert(
    captureLegalFlowRequest({
      supabase: failing, organizationId: "luis-gabriel-referral-hub", leadId: "lead-4", channelUserId: "15550001111",
      deliveryKey: "delivery-4", intakeType: "DUI", completedAt: "2026-09-01T00:00:00.000Z",
      fields: { full_name: "Ana", description: "..." },
    }).then(() => false).catch(() => true),
  );
});

// --- Bug A regression: captureImmigrationFlowRequest forwards the new -----
// --- micro-intake structured fields into the RPC's p_intake, instead of ---
// --- silently dropping them (the exact defect the integration audit found)

Deno.test("captureImmigrationFlowRequest forwards FAMILY_GREEN_CARD's structured fields into p_intake", async () => {
  const supabase = mockSupabase({
    capture_immigration_flow_request: { success: true, request_id: "req-fgc", created: true, assigned: false, notification_created: false },
  });
  await captureImmigrationFlowRequest({
    supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-fgc", channelUserId: "15550001111",
    deliveryKey: "delivery-fgc",
    completion: {
      topic: "FAMILY_GREEN_CARD", postal_code: "30071", description: "Mi esposa me quiere pedir.",
      completed_at: "2026-09-01T00:00:00.000Z", sharing_consent: "AUTHORIZED",
      petitioner_relationship: "US_CITIZEN_SPOUSE", entry_method: "VISA", prior_uscis_petition: "NO",
    },
  });
  const intake = supabase.calls[0].args.p_intake as Record<string, unknown>;
  assertEquals(intake.petitioner_relationship, "US_CITIZEN_SPOUSE");
  assertEquals(intake.entry_method, "VISA");
  assertEquals(intake.prior_uscis_petition, "NO");
  // Fields that don't apply to this topic must still be present as null —
  // never missing, never undefined — so every intake row has a consistent
  // key set regardless of topic.
  assertEquals(intake.resident_duration, null);
  assertEquals(intake.work_permit_status, null);
});

Deno.test("captureImmigrationFlowRequest forwards ASYLUM's structured fields into p_intake", async () => {
  const supabase = mockSupabase({
    capture_immigration_flow_request: { success: true, request_id: "req-asylum", created: true, assigned: false, notification_created: false },
  });
  await captureImmigrationFlowRequest({
    supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-asylum", channelUserId: "15550001111",
    deliveryKey: "delivery-asylum",
    completion: {
      topic: "ASYLUM", postal_code: "30071", description: "Busco protección.",
      completed_at: "2026-09-01T00:00:00.000Z", sharing_consent: "AUTHORIZED",
      arrival_window: "LESS_THAN_ONE_YEAR", fear_reason: "POLITICAL", immigration_court_status: "NO",
    },
  });
  const intake = supabase.calls[0].args.p_intake as Record<string, unknown>;
  assertEquals(intake.arrival_window, "LESS_THAN_ONE_YEAR");
  assertEquals(intake.fear_reason, "POLITICAL");
  assertEquals(intake.immigration_court_status, "NO");
  assertEquals(intake.petitioner_relationship, null);
});

Deno.test("captureImmigrationFlowRequest: an old completion with no micro-intake fields still parses and persists normally (backward compatible)", async () => {
  const supabase = mockSupabase({
    capture_immigration_flow_request: { success: true, request_id: "req-old", created: true, assigned: false, notification_created: false },
  });
  await captureImmigrationFlowRequest({
    supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-old", channelUserId: "15550001111",
    deliveryKey: "delivery-old",
    // Exactly the pre-V1 field set — no new keys at all.
    completion: {
      topic: "CONSULTATION", postal_code: "30071", description: "Necesito orientación.",
      completed_at: "2026-09-01T00:00:00.000Z", sharing_consent: "AUTHORIZED",
      consent_version: "luis_immigration_sharing_v1", consent_source: "whatsapp_flow",
    },
  });
  const intake = supabase.calls[0].args.p_intake as Record<string, unknown>;
  assertEquals(intake.topic, "CONSULTATION");
  assertEquals(intake.description, "Necesito orientación.");
  // Every new field defaults to null rather than being omitted or throwing.
  for (
    const field of [
      "resident_duration", "long_absence", "citizenship_marriage_basis",
      "petitioner_relationship", "entry_method", "prior_uscis_petition",
      "green_card_term", "green_card_issue", "prior_related_filing",
      "arrival_window", "fear_reason", "immigration_court_status",
      "crime_victim", "police_report", "law_enforcement_cooperation",
      "work_permit_request_type", "work_permit_basis", "work_permit_status",
    ]
  ) assertEquals(intake[field], null, `${field} must default to null`);
});
