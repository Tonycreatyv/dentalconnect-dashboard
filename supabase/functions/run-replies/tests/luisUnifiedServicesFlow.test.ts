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

Deno.test("unified Luis services Flow is static and branches from the approved five-service menu", () => {
  assertEquals(flow.version, "7.3");
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
  ]);
  assertEquals(Object.keys(completePayload("ACCIDENT_DETAILS")), [
    "service_key",
    "intake_type",
    "accident_date",
    "participation",
    "received_medical_attention",
    "full_name",
    "medical_provider",
    "description",
  ]);
  assertEquals(Object.keys(completePayload("CRIMINAL_DETAILS")), [
    "service_key",
    "intake_type",
    "topic",
    "full_name",
    "postal_code",
    "description",
  ]);
  assertEquals(completePayload("HANDOFF_CONFIRM"), { service_key: "HANDOFF" });
  assertEquals(completePayload("BENEFIT_DETAILS").service_key, "BENEFITS");
  assertEquals(
    completePayload("IMMIGRATION_CONSENT").intake_type,
    "IMMIGRATION",
  );
  assertEquals(
    completePayload("ACCIDENT_DETAILS").intake_type,
    "AUTO_ACCIDENT",
  );
  assertEquals(completePayload("CRIMINAL_DETAILS").intake_type, "DUI_CRIMINAL");
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
