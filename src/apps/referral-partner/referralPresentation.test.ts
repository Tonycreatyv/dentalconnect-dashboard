/// <reference lib="deno.ns" />
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildHumanSummary,
  buildIntakeSummary,
  intakeDescription,
  referralServiceLabel,
  referralTopicLabel,
  resolveIncidentDateFact,
  resolveReferralService,
  resolveSummaryTopicKey,
  resolveTopicDisplay,
} from "./referralPresentation.ts";

Deno.test("renders family green card intake without raw enum constants", () => {
  // petitioner_relationship/entry_method/prior_uscis_petition values below are
  // the real ids luis-unified-services-flow.json's FAMILY_GC_DETAILS screen
  // emits — not the originally-planned contract.
  assertEquals(buildIntakeSummary({ petitioner_relationship: "US_CITIZEN_SPOUSE", entry_method: "VISA", prior_uscis_petition: "NO" }, "FAMILY_GREEN_CARD"), "Cónyuge ciudadano/a · Entró con visa · No ha presentado petición");
});

Deno.test("renders future legal services only as presentation data", () => {
  assertEquals(resolveReferralService("luis_accidente"), "auto_accident");
  assertEquals(referralTopicLabel("DUI", "dui"), "DUI");
  // chemical_test/court_date_status values below are the real ids
  // luis-unified-services-flow.json's DUI_DETAILS screen emits.
  assertEquals(buildIntakeSummary({ chemical_test: "COMPLETED", court_date_status: "YES" }, "DUI"), "Realizó la prueba estatal · Tiene fecha de corte");
});

// --- Bug B regression: the wiring fix from the final integration audit ----

Deno.test("resolveSummaryTopicKey prefers intake.topic (immigration), falls back to intake.intake_type (legal), never invents a value", () => {
  assertEquals(resolveSummaryTopicKey({ topic: "CITIZENSHIP", intake_type: "IMMIGRATION" }), "CITIZENSHIP");
  assertEquals(resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" }), "AUTO_ACCIDENT");
  assertEquals(resolveSummaryTopicKey({ intake_type: "DUI" }), "DUI");
  assertEquals(resolveSummaryTopicKey({ intake_type: "CRIMINAL" }), "CRIMINAL");
  assertEquals(resolveSummaryTopicKey({}), null);
});

Deno.test("buildIntakeSummary renders structured facts for AUTO_ACCIDENT/DUI/CRIMINAL when keyed by intake_type (the real fix — not opportunity.topic, which is always null for these)", () => {
  const accidentKey = resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" });
  assert(
    buildIntakeSummary({ accident_date: "2026-08-20", received_medical_attention: "YES", police_report: "YES" }, accidentKey),
  );
  const duiKey = resolveSummaryTopicKey({ intake_type: "DUI" });
  assert(buildIntakeSummary({ chemical_test: "YES", court_date_status: "COURT_DATE_SET" }, duiKey));
  const criminalKey = resolveSummaryTopicKey({ intake_type: "CRIMINAL" });
  assert(buildIntakeSummary({ currently_detained: "YES" }, criminalKey));
});

Deno.test("buildIntakeSummary renders structured facts for the new immigration topics when keyed by intake.topic", () => {
  assert(
    buildIntakeSummary(
      { petitioner_relationship: "US_CITIZEN_SPOUSE", entry_method: "VISA", prior_uscis_petition: "NO" },
      resolveSummaryTopicKey({ topic: "FAMILY_GREEN_CARD" }),
    ),
  );
});

Deno.test("buildIntakeSummary formats accident_date/dui_date compactly instead of the raw YYYY-MM-DD value", () => {
  const accidentKey = resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" });
  const summary = buildIntakeSummary(
    { accident_date: "2026-09-02", received_medical_attention: "YES", police_report: "YES" },
    accidentKey,
  );
  // ICU's es-ES short month for September renders "sept" (not "sep") in
  // this runtime — asserting the real Intl output, not a hand-picked one.
  assertEquals(summary, "2 sept 2026 · Recibió atención médica · Hubo reporte policial");
  assert(!summary!.includes("2026-09-02"));

  const duiKey = resolveSummaryTopicKey({ intake_type: "DUI" });
  const duiSummary = buildIntakeSummary({ dui_date: "2026-08-14", chemical_test: "YES" }, duiKey);
  assertEquals(duiSummary, "14 ago 2026 · Sí");
});

Deno.test("buildIntakeSummary's compact incident date does not shift the calendar day", () => {
  const accidentKey = resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" });
  const summary = buildIntakeSummary({ accident_date: "2026-01-01" }, accidentKey);
  assertEquals(summary, "1 ene 2026");
});

Deno.test("omitIncidentDate removes accident_date/dui_date from the shared-info summary but keeps every other fact", () => {
  const accidentKey = resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" });
  const withDate = buildIntakeSummary(
    { accident_date: "2026-09-02", received_medical_attention: "YES", police_report: "YES" },
    accidentKey,
  );
  const withoutDate = buildIntakeSummary(
    { accident_date: "2026-09-02", received_medical_attention: "YES", police_report: "YES" },
    accidentKey,
    { omitIncidentDate: true },
  );
  assertEquals(withDate, "2 sept 2026 · Recibió atención médica · Hubo reporte policial");
  assertEquals(withoutDate, "Recibió atención médica · Hubo reporte policial");
});

Deno.test("omitIncidentDate on a service with no incident date field is a no-op — existing behavior preserved", () => {
  const criminalKey = resolveSummaryTopicKey({ intake_type: "CRIMINAL" });
  const summary = buildIntakeSummary({ currently_detained: "YES" }, criminalKey, { omitIncidentDate: true });
  assertEquals(summary, buildIntakeSummary({ currently_detained: "YES" }, criminalKey));
});

Deno.test("resolveTopicDisplay collapses to null when the topic label would just repeat the service label — AUTO_ACCIDENT/DUI/CRIMINAL", () => {
  assertEquals(resolveTopicDisplay(null, "auto_accident"), null);
  assertEquals(resolveTopicDisplay(null, "dui"), null);
  assertEquals(resolveTopicDisplay(null, "criminal"), null);
  // Confirms there is no "X · X": the label that WOULD render equals the service label.
  assertEquals(referralTopicLabel(null, "auto_accident"), referralServiceLabel("auto_accident"));
});

Deno.test("resolveTopicDisplay still shows the real per-topic label for immigration — never collapses genuine information", () => {
  assertEquals(resolveTopicDisplay("CITIZENSHIP", "immigration"), "Ciudadanía");
  assertEquals(resolveTopicDisplay("FAMILY_GREEN_CARD", "immigration"), "Petición familiar / Green Card");
  assertEquals(resolveTopicDisplay("ASYLUM", "immigration"), "Asilo");
});

Deno.test("old immigration rows with only topic/description/postal_code/consent (no micro-intake fields) still render cleanly — no summary, description intact", () => {
  const intake = { topic: "CONSULTATION", description: "Necesito orientación.", postal_code: "30071" };
  assertEquals(buildIntakeSummary(intake, resolveSummaryTopicKey(intake)), null);
  assertEquals(intakeDescription(intake), "Necesito orientación.");
  assertEquals(resolveTopicDisplay("CONSULTATION", "immigration"), "Consulta de inmigración");
});

// --- Cosmetic pass: no raw Flow enum ids leak into the rendered summary for
// any of the 9 micro-intake branches, using the real ids
// luis-unified-services-flow.json emits for each field (verified against the
// Flow JSON, not the originally-planned contract).

const RAW_ENUM_NEEDLES = [
  "US_CITIZEN_SPOUSE",
  "LESS_THAN_ONE_YEAR",
  "MORE_THAN_5_YEARS",
  "COMPLETED",
  "REFUSED",
  "WITHOUT_INSPECTION",
  "NOT_SURE",
  "RELIGION",
  "RENEWAL",
  "NONE",
];

function assertNoRawEnums(summary: string | null) {
  assert(summary, "expected a rendered summary");
  for (const needle of RAW_ENUM_NEEDLES) {
    assert(!summary!.includes(needle), `summary "${summary}" leaked raw enum "${needle}"`);
  }
}

Deno.test("Family/Green Card summary has no raw enum leakage", () => {
  const summary = buildIntakeSummary(
    { petitioner_relationship: "US_CITIZEN_SPOUSE", entry_method: "WITHOUT_INSPECTION", prior_uscis_petition: "NOT_SURE" },
    "FAMILY_GREEN_CARD",
  );
  assertEquals(summary, "Cónyuge ciudadano/a · Entró sin inspección · No está seguro/a");
  assertNoRawEnums(summary);
});

Deno.test("Citizenship summary has no raw enum leakage", () => {
  const summary = buildIntakeSummary(
    { resident_duration: "MORE_THAN_5_YEARS", long_absence: "NOT_SURE", citizenship_marriage_basis: "YES" },
    "CITIZENSHIP",
  );
  assertEquals(summary, "Residente por más de 5 años · No está seguro/a · Basado en matrimonio con ciudadano/a");
  assertNoRawEnums(summary);
});

Deno.test("Asylum summary has no raw enum leakage", () => {
  const summary = buildIntakeSummary(
    { arrival_window: "LESS_THAN_ONE_YEAR", fear_reason: "RELIGION", immigration_court_status: "NOT_SURE" },
    "ASYLUM",
  );
  assertEquals(summary, "Llegó hace menos de 1 año · Motivo religioso · No está seguro/a");
  assertNoRawEnums(summary);
});

Deno.test("Work Permit summary has no raw enum leakage", () => {
  const summary = buildIntakeSummary(
    { work_permit_request_type: "RENEWAL", work_permit_basis: "TPS", work_permit_status: "NONE" },
    "WORK_PERMIT",
  );
  assertEquals(summary, "Renovación · TPS · No tiene permiso actual");
  assertNoRawEnums(summary);
});

Deno.test("Auto Accident summary has no raw enum leakage", () => {
  const summary = buildIntakeSummary(
    { received_medical_attention: "YES", police_report: "NOT_SURE" },
    resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" }),
  );
  assertEquals(summary, "Recibió atención médica · No está seguro/a");
  assertNoRawEnums(summary);
});

Deno.test("DUI summary has no raw enum leakage", () => {
  const summary = buildIntakeSummary(
    { chemical_test: "COMPLETED", court_date_status: "NOT_SURE" },
    resolveSummaryTopicKey({ intake_type: "DUI" }),
  );
  assertEquals(summary, "Realizó la prueba estatal · No está seguro/a");
  assertNoRawEnums(summary);
});

Deno.test("Criminal summary has no raw enum leakage", () => {
  const summary = buildIntakeSummary(
    { court_date_status: "YES", currently_detained: "NO" },
    resolveSummaryTopicKey({ intake_type: "CRIMINAL" }),
  );
  assertEquals(summary, "Tiene fecha de corte · Actualmente en libertad");
  assertNoRawEnums(summary);
});

// Fallback safety: an unrecognized future enum value must never throw and
// must never hide the rest of the summary — it renders as its own raw string
// (still better than crashing or dropping the field) until a label is added.
Deno.test("unknown future enum values degrade to the raw string, never throw, never hide the rest of the summary", () => {
  const summary = buildIntakeSummary(
    { petitioner_relationship: "SOME_FUTURE_VALUE_NOT_YET_LABELED", entry_method: "VISA", prior_uscis_petition: "NO" },
    "FAMILY_GREEN_CARD",
  );
  assertEquals(summary, "SOME_FUTURE_VALUE_NOT_YET_LABELED · Entró con visa · No ha presentado petición");
});

// --- Filters: service resolution is what the Partner list filter groups by

// --- buildHumanSummary: narrative "Resumen de la consulta" ---------------

Deno.test("buildHumanSummary composes a full narrative from real auto_accident intake, weaving the narrative description and flagging the ambiguous field with its context", () => {
  const summary = buildHumanSummary({
    leadName: "José Durán",
    service: "auto_accident",
    topicKey: resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" }),
    intake: {
      accident_date: "2026-09-02",
      description: "fue chocado por detrás mientras estaba detenido en un stop",
      received_medical_attention: "YES",
      police_report: "NOT_SURE",
    },
    consentStatus: "authorized",
  });
  assertEquals(
    summary,
    "José Durán reporta que tuvo un accidente el 2 de septiembre de 2026. Indica que fue chocado por detrás mientras estaba detenido en un stop. Recibió atención médica. Reporte policial: No está seguro/a. Autorizó que lo contacten.",
  );
});

Deno.test("buildHumanSummary never invents a fact for a field the intake doesn't have — no date clause, no narrative sentence, no structured sentence", () => {
  const summary = buildHumanSummary({
    leadName: "Ana",
    service: "auto_accident",
    topicKey: resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" }),
    intake: {},
    consentStatus: null,
  });
  assertEquals(summary, "Ana reporta que tuvo un accidente.");
});

Deno.test("buildHumanSummary weaves clear YES/NO facts into one flowing sentence and declines consent when the intake says so", () => {
  const summary = buildHumanSummary({
    leadName: "María",
    service: "immigration",
    topicKey: "CITIZENSHIP",
    intake: {
      resident_duration: "MORE_THAN_5_YEARS",
      long_absence: "NOT_SURE",
      citizenship_marriage_basis: "YES",
      description: "Quiero aplicar pronto",
    },
    consentStatus: "declined",
  });
  assertEquals(
    summary,
    "María consulta sobre ciudadanía. Indica que Quiero aplicar pronto. Residente por más de 5 años y basado en matrimonio con ciudadano/a. Ausencia prolongada: No está seguro/a. No autorizó que lo contacten.",
  );
});

Deno.test("buildHumanSummary always gives an ambiguous value its field label/context — never a bare 'No está seguro/a'", () => {
  const dui = buildHumanSummary({
    leadName: "Luis",
    service: "dui",
    topicKey: resolveSummaryTopicKey({ intake_type: "DUI" }),
    intake: { chemical_test: "NOT_SURE" },
  });
  assert(dui.includes("Prueba estatal: No está seguro/a"));
  const criminal = buildHumanSummary({
    leadName: "Luis",
    service: "criminal",
    topicKey: resolveSummaryTopicKey({ intake_type: "CRIMINAL" }),
    intake: { criminal_charge: "hurto menor", currently_detained: "NOT_SURE" },
  });
  assert(criminal.includes("Detención actual: No está seguro/a"));
  assert(criminal.includes("hurto menor"));
});

Deno.test("buildHumanSummary omits the consent sentence entirely when consent is pending/unknown, rather than inventing a status", () => {
  const summary = buildHumanSummary({
    leadName: "Pedro",
    service: "dui",
    topicKey: resolveSummaryTopicKey({ intake_type: "DUI" }),
    intake: { dui_date: "2026-08-14" },
    consentStatus: "pending_review",
  });
  assert(!summary.includes("autorizó"));
  assert(!summary.toLowerCase().includes("no autorizó"));
});

Deno.test("resolveReferralService gives each of the 4 filterable categories a stable, distinct value", () => {
  assertEquals(resolveReferralService(undefined, { service: "immigration" }), "immigration");
  assertEquals(resolveReferralService(undefined, { service: "auto_accident" }), "auto_accident");
  assertEquals(resolveReferralService(undefined, { service: "dui" }), "dui");
  assertEquals(resolveReferralService(undefined, { service: "criminal" }), "criminal");
  // Unknown/garbage service values resolve to null, never crash and never
  // silently join another category — the caller (PartnerList) defaults an
  // unresolved service to "immigration" only as an existing-query fallback,
  // not something this helper should paper over.
  assertEquals(resolveReferralService(undefined, { service: "not_a_real_service" }), null);
});

// --- resolveIncidentDateFact: explicit "Fecha del accidente"/"Fecha del DUI" ---

Deno.test("resolveIncidentDateFact labels the auto_accident date without shifting the calendar day", () => {
  // 2026-09-02 is a bare date-only string. formatHumanDate parses it as a
  // local calendar date rather than handing it to `new Date(raw)` (which the
  // JS spec parses as UTC midnight), so this must still read "2 de
  // septiembre" even when the test runner's local timezone is behind UTC.
  const fact = resolveIncidentDateFact("auto_accident", { accident_date: "2026-09-02" });
  assertEquals(fact, { label: "Fecha del accidente", value: "2 de septiembre de 2026" });
});

Deno.test("resolveIncidentDateFact labels the DUI date under its own distinct label", () => {
  const fact = resolveIncidentDateFact("dui", { dui_date: "2026-08-14" });
  assertEquals(fact, { label: "Fecha del DUI", value: "14 de agosto de 2026" });
});

Deno.test("resolveIncidentDateFact never invents a date — missing value or non-dated service both resolve to null", () => {
  assertEquals(resolveIncidentDateFact("auto_accident", {}), null);
  assertEquals(resolveIncidentDateFact("immigration", { accident_date: "2026-09-02" }), null);
  assertEquals(resolveIncidentDateFact("criminal", {}), null);
  assertEquals(resolveIncidentDateFact(null, { accident_date: "2026-09-02" }), null);
});

Deno.test("buildHumanSummary omits the embedded incident date when includeIncidentDate is false, but keeps the rest of the sentence", () => {
  const withDate = buildHumanSummary({
    leadName: "José Durán",
    service: "auto_accident",
    topicKey: resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" }),
    intake: { accident_date: "2026-09-02" },
    includeIncidentDate: false,
  });
  assertEquals(withDate, "José Durán reporta que tuvo un accidente.");
  assert(!withDate.includes("septiembre"));

  const dui = buildHumanSummary({
    leadName: "Ana",
    service: "dui",
    topicKey: resolveSummaryTopicKey({ intake_type: "DUI" }),
    intake: { dui_date: "2026-08-14" },
    includeIncidentDate: false,
  });
  assertEquals(dui, "Ana reporta un caso de DUI.");
});

Deno.test("buildHumanSummary still embeds the incident date by default — includeIncidentDate is opt-out, not opt-in", () => {
  const summary = buildHumanSummary({
    leadName: "José Durán",
    service: "auto_accident",
    topicKey: resolveSummaryTopicKey({ intake_type: "AUTO_ACCIDENT" }),
    intake: { accident_date: "2026-09-02" },
  });
  assert(summary.includes("el 2 de septiembre de 2026"));
});


Deno.test("non-legal services have explicit neutral presentation labels", () => {
  assertEquals(resolveReferralService("luis_muebles"), "furniture");
  assertEquals(referralServiceLabel("furniture"), "Muebles");
  assertEquals(resolveReferralService("luis_representante"), "representative");
  assertEquals(referralServiceLabel("representative"), "Hablar con nuestro equipo");
  assertEquals(referralServiceLabel(null), "Servicio");
});

Deno.test("combined DUI/Criminal production id uses topic to avoid false DUI classification", () => {
  assertEquals(resolveReferralService("luis_dui_criminal", { intake_type: "DUI_CRIMINAL", topic: "DUI" }), "dui");
  assertEquals(resolveReferralService("luis_dui_criminal", { intake_type: "DUI_CRIMINAL", topic: "CRIMINAL_CHARGE" }), "criminal");
});
