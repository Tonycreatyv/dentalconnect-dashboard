import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyLuisFlowCompletion,
  parseLuisBenefitFlowCompletion,
  parseLuisLegalFlowCompletion,
} from "../../_products/referral-hub/luisBenefits.ts";

const productDir = new URL("../../_products/referral-hub/", import.meta.url);
const source = await Deno.readTextFile(
  new URL("luis-unified-services-flow.json", productDir),
);
const flow = JSON.parse(source) as {
  version: string;
  screens: Array<any>;
  routing_model: Record<string, string[]>;
};

const sourceFlowHashes: Record<string, string> = {
  "luis-benefits-flow.json":
    "888d4f5af09fb4c938053afbfb353032d06dd133b6234487a848e1d5b7496269",
  "luis-immigration-flow.json":
    "57cdb97411aaa3ee066cd2a743eba0c7468d6006573a3e187c18760a4aacc81a",
  "luis-auto-accident-flow.json":
    "2f2e3523eeb006f984ff51951b7b62dcef0f4f6a3c6d4eaad069bce2ab44efde",
  "luis-dui-criminal-flow.json":
    "26b52abfb9e0704dbb918d4eebcb97ca34bbadb4dd6153acb0e3b4553b7dc759",
};

async function sha256(source: string) {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function screen(id: string) {
  const found = flow.screens.find((entry) => entry.id === id);
  assert(found, `missing ${id}`);
  return found;
}

function completePayload(id: string) {
  const footer = screen(id).layout.children.find((child: any) =>
    child?.["on-click-action"]?.name === "complete"
  );
  assert(footer, `missing terminal complete footer for ${id}`);
  return footer["on-click-action"].payload;
}

function navigatePayload(id: string) {
  const footer = screen(id).layout.children.find((child: any) =>
    child?.["on-click-action"]?.name === "navigate"
  );
  assert(footer, `missing navigate footer for ${id}`);
  return footer["on-click-action"].payload;
}

Deno.test("unified Luis services Flow is static and branches from the approved five-service menu", () => {
  assertEquals(flow.version, "7.3");
  // Runtime recovery (Sep 2026): NavigationList only works reliably as the
  // Flow's entry screen (SERVICE_SELECT) — chaining a second NavigationList
  // on IMMIGRATION_TOPIC/CRIMINAL_TOPIC produced "Something went wrong" on
  // real devices despite passing Meta's static asset validation. Both are
  // now RadioButtonsGroup+Footer (the pattern already proven by
  // ACCIDENT_BASICS/BENEFIT_SELECT), and IMMIGRATION_TOPIC's 7 topic-specific
  // detail screens / CRIMINAL_TOPIC's DUI+CRIMINAL detail screens collapsed
  // into one IMMIGRATION_DETAILS / CRIMINAL_DETAILS screen each, with a
  // Switch component (Meta's documented conditional-rendering feature)
  // showing only the fields for the selected topic. Micro-intake fields and
  // the backend completion contract are unchanged.
  assertEquals(flow.screens.map((entry) => entry.id), [
    "SERVICE_SELECT",
    "BENEFIT_SELECT",
    "BENEFIT_DETAILS",
    "IMMIGRATION_TOPIC",
    "IMMIGRATION_DETAILS",
    "IMMIGRATION_CONSENT",
    "ACCIDENT_BASICS",
    "ACCIDENT_DETAILS",
    "CRIMINAL_TOPIC",
    "CRIMINAL_DETAILS",
    "LEGAL_CONSENT",
    "HANDOFF_CONFIRM",
  ]);
  assertEquals(flow.routing_model.SERVICE_SELECT, [
    "BENEFIT_SELECT",
    "IMMIGRATION_TOPIC",
    "ACCIDENT_BASICS",
    "CRIMINAL_TOPIC",
    "HANDOFF_CONFIRM",
  ]);
  const menu = screen("SERVICE_SELECT").layout.children[0];
  assertEquals(menu.type, "NavigationList");
  assertEquals(menu["list-items"].map((item: any) => item.id), [
    "BENEFITS",
    "IMMIGRATION",
    "AUTO_ACCIDENT",
    "DUI_CRIMINAL",
    "HANDOFF",
  ]);
  for (const item of menu["list-items"]) {
    assertEquals(item["on-click-action"].name, "navigate");
    assertEquals(item["on-click-action"].payload, {});
  }
  // IMMIGRATION_TOPIC/CRIMINAL_TOPIC must never reintroduce a chained
  // NavigationList — that's the exact pattern that broke on real devices.
  for (const id of ["IMMIGRATION_TOPIC", "CRIMINAL_TOPIC"]) {
    assertEquals(
      screen(id).layout.children.some((child: any) => child.type === "NavigationList"),
      false,
      `${id} must not use NavigationList (non-entry screens only support RadioButtonsGroup+Footer navigation)`,
    );
  }
  assertEquals(source.includes("data_exchange"), false);
  assertEquals(source.includes("data_api_version"), false);
  assertEquals(source.includes("endpoint_uri"), false);
  assertEquals(source.toLowerCase().includes("grocery"), false);
  assertEquals(source.toLowerCase().includes("delivery"), false);
  assertEquals(source.toLowerCase().includes("phone"), false);
});

Deno.test("unified Flow routing_model contains every screen and every navigate edge exactly once", () => {
  const screenIds = flow.screens.map((entry) => entry.id);

  // Every screen ID must be a routing_model key (required for Meta Flow
  // Builder Preview to resolve the entry screen and every downstream hop).
  assertEquals(Object.keys(flow.routing_model).sort(), [...screenIds].sort());

  // Every navigate action's target must exist as a routing_model key.
  const navigateTargets = new Set<string>();
  for (const entry of flow.screens) {
    for (const child of entry.layout.children) {
      if (child?.["on-click-action"]?.name === "navigate") {
        navigateTargets.add(child["on-click-action"].next.name);
      }
      for (const item of child?.["list-items"] ?? []) {
        if (item?.["on-click-action"]?.name === "navigate") {
          navigateTargets.add(item["on-click-action"].next.name);
        }
      }
    }
  }
  for (const target of navigateTargets) {
    assert(
      Object.prototype.hasOwnProperty.call(flow.routing_model, target),
      `navigate target ${target} missing from routing_model`,
    );
  }

  // routing_model[screen] must exactly equal the navigate targets actually
  // used by that screen (no missing edges, no phantom/unused edges).
  for (const entry of flow.screens) {
    const used = new Set<string>();
    for (const child of entry.layout.children) {
      if (child?.["on-click-action"]?.name === "navigate") {
        used.add(child["on-click-action"].next.name);
      }
      for (const item of child?.["list-items"] ?? []) {
        if (item?.["on-click-action"]?.name === "navigate") {
          used.add(item["on-click-action"].next.name);
        }
      }
    }
    assertEquals(
      new Set(flow.routing_model[entry.id]),
      used,
      `routing_model[${entry.id}] does not match its actual navigate targets`,
    );
  }

  // Terminal screens (complete-only, no further navigation) route to nothing.
  for (const entry of flow.screens) {
    if (entry.terminal) assertEquals(flow.routing_model[entry.id], []);
  }

  // SERVICE_SELECT is the unique entry point: no screen routes to it.
  const allTargets = new Set(Object.values(flow.routing_model).flat());
  assert(!allTargets.has("SERVICE_SELECT"));
});

Deno.test("unified Flow preserves benefits and legal flat completion contracts with a service discriminator", () => {
  assertEquals(Object.keys(completePayload("BENEFIT_DETAILS")), [
    "service_key",
    "benefit_key",
    "full_name",
    "postal_code",
    "email",
    "marketing_consent",
  ]);
  assertEquals(Object.keys(completePayload("IMMIGRATION_CONSENT")), [
    "service_key",
    "intake_type",
    "topic",
    "full_name",
    "postal_code",
    "description",
    "sharing_consent",
    "consent_version",
    "consent_source",
    "resident_duration",
    "long_absence",
    "citizenship_marriage_basis",
    "petitioner_relationship",
    "entry_method",
    "prior_uscis_petition",
    "green_card_term",
    "green_card_issue",
    "prior_related_filing",
    "arrival_window",
    "fear_reason",
    "immigration_court_status",
    "crime_victim",
    "police_report",
    "law_enforcement_cooperation",
    "work_permit_request_type",
    "work_permit_basis",
    "work_permit_status",
  ]);
  // ACCIDENT_DETAILS/CRIMINAL_DETAILS no longer complete directly — they
  // navigate into the new shared LEGAL_CONSENT terminal (accident/DUI/
  // criminal never had a consent step before V1). CRIMINAL_DETAILS now
  // covers both DUI and CRIMINAL (merged screen, Switch-gated fields).
  assertEquals(Object.keys(navigatePayload("ACCIDENT_DETAILS")), [
    "intake_type",
    "full_name",
    "postal_code",
    "description",
    "accident_date",
    "received_medical_attention",
    "police_report",
    "dui_date",
    "chemical_test",
    "court_date_status",
    "criminal_charge",
    "currently_detained",
  ]);
  assertEquals(Object.keys(navigatePayload("CRIMINAL_DETAILS")), [
    "intake_type",
    "full_name",
    "postal_code",
    "description",
    "accident_date",
    "received_medical_attention",
    "police_report",
    "dui_date",
    "chemical_test",
    "court_date_status",
    "criminal_charge",
    "currently_detained",
  ]);
  assertEquals(Object.keys(completePayload("LEGAL_CONSENT")), [
    "service_key",
    "intake_type",
    "full_name",
    "postal_code",
    "description",
    "sharing_consent",
    "consent_version",
    "consent_source",
    "accident_date",
    "received_medical_attention",
    "police_report",
    "dui_date",
    "chemical_test",
    "court_date_status",
    "criminal_charge",
    "currently_detained",
  ]);
  assertEquals(completePayload("HANDOFF_CONFIRM"), { service_key: "HANDOFF" });
  assertEquals(completePayload("BENEFIT_DETAILS").service_key, "BENEFITS");
  assertEquals(
    completePayload("IMMIGRATION_CONSENT").intake_type,
    "IMMIGRATION",
  );
  assertEquals(navigatePayload("ACCIDENT_DETAILS").intake_type, "AUTO_ACCIDENT");
  // CRIMINAL_DETAILS now serves both DUI and CRIMINAL (merged via Switch on
  // CRIMINAL_TOPIC's case_type selection), so intake_type forwards whichever
  // case_type the caller passed rather than a per-screen literal.
  assertEquals(navigatePayload("CRIMINAL_DETAILS").intake_type, "${data.case_type}");
  // LEGAL_CONSENT's own complete payload forwards whichever intake_type its
  // caller passed via ${data.intake_type} — it is not a literal on this
  // shared screen (unlike IMMIGRATION_CONSENT, which has exactly one
  // caller-shape family and can hardcode "IMMIGRATION").
  assertEquals(completePayload("LEGAL_CONSENT").service_key, "${data.intake_type}");
  assertEquals(completePayload("LEGAL_CONSENT").intake_type, "${data.intake_type}");
  const benefits = screen("BENEFIT_SELECT").layout.children.find((child: any) =>
    child.name === "benefit_key"
  );
  assertEquals(benefits["data-source"].map((item: any) => item.id), [
    "SUPERMARKET",
    "MEDICAL",
    "DENTAL",
    "SHIPPING",
  ]);
  const email = screen("BENEFIT_DETAILS").layout.children.find((child: any) =>
    child.name === "email"
  );
  assertEquals(email.label, "Correo");
  assertEquals(email.required, false);

  const benefitsPayload = completePayload("BENEFIT_DETAILS");
  assertEquals(
    classifyLuisFlowCompletion({
      ...benefitsPayload,
      benefit_key: "SUPERMARKET",
      full_name: "Ana López",
      postal_code: "30071",
      email: "",
      marketing_consent: false,
    }),
    "BENEFITS",
  );
  assertEquals(
    parseLuisBenefitFlowCompletion({
      ...benefitsPayload,
      benefit_key: "SUPERMARKET",
      full_name: "Ana López",
      postal_code: "30071",
      email: "",
      marketing_consent: false,
    })?.benefit_key,
    "SUPERMARKET",
  );
  assertEquals(
    classifyLuisFlowCompletion({
      ...completePayload("IMMIGRATION_CONSENT"),
      topic: "CONSULTATION",
      full_name: "Ana López",
      postal_code: "30071",
      description: "Necesito orientación.",
    }),
    "LEGAL",
  );
  assertEquals(
    parseLuisLegalFlowCompletion({
      ...completePayload("IMMIGRATION_CONSENT"),
      topic: "CONSULTATION",
      full_name: "Ana López",
      postal_code: "30071",
      description: "Necesito orientación.",
    })?.intake_type,
    "IMMIGRATION",
  );
});

Deno.test("unified Flow uses branch-specific fields and customer-facing Spanish without internal keys or outcome promises", () => {
  const visible = flow.screens.flatMap((entry) => entry.layout.children).map((
    child: any,
  ) =>
    JSON.stringify({
      title: child?.["main-content"]?.title,
      label: child?.label,
      text: child?.text,
      description: child?.description,
      items: child?.["data-source"]?.map((item: any) => ({
        title: item.title,
        description: item.description,
      })),
    })
  ).join(" ");
  for (
    const internal of [
      "SUPERMARKET",
      "AUTO_ACCIDENT",
      "DUI_CRIMINAL",
      "service_key",
      "intake_type",
    ]
  ) assertEquals(visible.includes(internal), false);
  for (
    const forbidden of [
      "garantizamos",
      "calificás",
      "te aprobamos",
      "compensación",
      "diagnóstico",
      "tratamiento",
    ]
  ) assertEquals(visible.toLowerCase().includes(forbidden), false);
  assert(visible.includes("Te saluda Luis Gabriel."));
  assert(visible.includes("¿En qué podemos ayudarte hoy?"));
  assert(visible.includes("Sí, quiero recibir beneficios y promociones."));
  assertEquals(
    screen("BENEFIT_DETAILS").layout.children.some((child: any) =>
      child.name === "description"
    ),
    false,
  );
  assertEquals(
    screen("IMMIGRATION_DETAILS").layout.children.some((child: any) =>
      child.name === "accident_date"
    ),
    false,
  );
  const consent = screen("IMMIGRATION_CONSENT").layout.children.find((child: any) =>
    child.name === "sharing_consent"
  );
  const immigrationPostalCode = screen("IMMIGRATION_DETAILS").layout.children.find((child: any) =>
    child.name === "postal_code"
  );
  assertEquals(immigrationPostalCode.type, "TextInput");
  assertEquals(immigrationPostalCode["input-type"], "text");
  assertEquals(consent.required, true);
  assertEquals(consent["data-source"].map((item: any) => item.id), ["AUTHORIZED", "DECLINED"]);
  assertEquals(completePayload("IMMIGRATION_CONSENT").consent_version, "luis_immigration_sharing_v1");
  assertEquals(completePayload("IMMIGRATION_CONSENT").consent_source, "whatsapp_flow");
  assertEquals(
    screen("ACCIDENT_DETAILS").layout.children.some((child: any) =>
      child.name === "topic"
    ),
    false,
  );
});

Deno.test("the four approved source Flow references remain byte-for-byte unchanged", async () => {
  for (const [name, expectedHash] of Object.entries(sourceFlowHashes)) {
    assertEquals(
      await sha256(await Deno.readTextFile(new URL(name, productDir))),
      expectedHash,
      name,
    );
  }
});
