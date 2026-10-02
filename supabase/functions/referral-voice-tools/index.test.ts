import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  COUPON_SOURCE_ORGANIZATION_ID,
  type CouponCampaignRow,
  DEMO_REFERRAL_ORGANIZATION_ID,
  handleVoiceToolRequest,
  LG_REFERRAL_ORGANIZATION_ID,
  NON_COUPON_SOURCE_ORGANIZATION_ID,
  type ServiceConfigRow,
} from "./handler.ts";

const SECRET = "voice-test-secret-with-enough-entropy";
const serviceRows: ServiceConfigRow[] = [
  { id: "luis_compra_super", activo: true },
  { id: "luis_accidente", activo: true },
  { id: "luis_inmigracion", activo: true },
  { id: "luis_cupon_medico", activo: true },
  { id: "luis_cupon_super", activo: true },
  { id: "luis_eventos", activo: true },
  { id: "luis_representante", activo: true },
];
const campaigns: CouponCampaignRow[] = [
  {
    service_id: "luis_cupon_super",
    active: true,
    offer_terms: { discount_amount: 10, minimum_purchase: 100 },
  },
  {
    service_id: "luis_cupon_medico",
    active: true,
    offer_terms: { discount_percent: 20 },
  },
  {
    service_id: "luis_cupon_dental",
    active: true,
    offer_terms: { promotional_price: 29 },
  },
];

function request(
  body: unknown,
  options: { method?: string; secret?: string | null; contentType?: string } =
    {},
) {
  const headers = new Headers();
  if (options.secret !== null) {
    headers.set("x-creatyv-voice-secret", options.secret ?? SECRET);
  }
  if (options.contentType !== "") {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return new Request("https://example.test/referral-voice-tools", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET"
      ? undefined
      : typeof body === "string"
      ? body
      : JSON.stringify(body),
  });
}

function dependencies(overrides: Partial<{
  expectedSecret: string;
  services: ServiceConfigRow[];
  campaigns: CouponCampaignRow[];
  serviceError: unknown;
  campaignError: unknown;
}> = {}) {
  const serviceOrganizations: string[] = [];
  const campaignOrganizations: string[] = [];
  return {
    serviceOrganizations,
    campaignOrganizations,
    value: {
      expectedSecret: overrides.expectedSecret ?? SECRET,
      listActiveNonCouponServices: (organizationId: string) => {
        serviceOrganizations.push(organizationId);
        return Promise.resolve({
          data: overrides.services ?? serviceRows,
          error: overrides.serviceError ?? null,
        });
      },
      listActiveCouponCampaigns: (organizationId: string) => {
        campaignOrganizations.push(organizationId);
        return Promise.resolve({
          data: overrides.campaigns ?? campaigns,
          error: overrides.campaignError ?? null,
        });
      },
    },
  };
}

async function call(
  organizationId = LG_REFERRAL_ORGANIZATION_ID,
  deps = dependencies(),
) {
  const response = await handleVoiceToolRequest(
    request({ action: "list_services", organization_id: organizationId }),
    deps.value,
  );
  return { response, result: await response.json(), deps };
}

Deno.test("valid secret accepts list_services", async () => {
  const { response, result } = await call();
  assertEquals(response.status, 200);
  assertEquals(result.success, true);
});

Deno.test("missing and invalid secrets are unauthorized", async () => {
  for (const secret of [null, "incorrect"]) {
    const response = await handleVoiceToolRequest(
      request({}, { secret }),
      dependencies().value,
    );
    assertEquals(response.status, 401);
    assertEquals((await response.json()).error, "unauthorized");
  }
});

Deno.test("POST, JSON, action, and organization validation remains strict", async () => {
  const cases = [
    [request(null, { method: "GET" }), 405, "method_not_allowed"],
    [request("{not-json"), 400, "malformed_json"],
    [
      request({
        action: "run_sql",
        organization_id: LG_REFERRAL_ORGANIZATION_ID,
      }),
      400,
      "unsupported_action",
    ],
    [
      request({ organization_id: LG_REFERRAL_ORGANIZATION_ID }),
      400,
      "missing_action",
    ],
    [request({ action: "list_services" }), 400, "missing_organization_id"],
    [
      request({
        action: "list_services",
        organization_id: "dentalconnect",
      }),
      403,
      "organization_forbidden",
    ],
  ] as const;
  for (const [input, status, error] of cases) {
    const response = await handleVoiceToolRequest(input, dependencies().value);
    assertEquals(response.status, status);
    assertEquals((await response.json()).error, error);
  }
});

Deno.test("demo and LG tenants return eight services and preserve requested organization", async () => {
  for (
    const organizationId of [
      DEMO_REFERRAL_ORGANIZATION_ID,
      LG_REFERRAL_ORGANIZATION_ID,
    ]
  ) {
    const { response, result, deps } = await call(organizationId);
    assertEquals(response.status, 200);
    assertEquals(result.organization_id, organizationId);
    assertEquals(result.services.length, 8);
    assertEquals(deps.serviceOrganizations, [
      NON_COUPON_SOURCE_ORGANIZATION_ID,
    ]);
    assertEquals(deps.campaignOrganizations, [
      COUPON_SOURCE_ORGANIZATION_ID,
    ]);
  }
});

Deno.test("voice catalog has no read dependency on insurance-demo", async () => {
  const { result, deps } = await call(DEMO_REFERRAL_ORGANIZATION_ID);
  assertEquals(result.services.length, 8);
  assertEquals(deps.serviceOrganizations, [LG_REFERRAL_ORGANIZATION_ID]);
  assertEquals(deps.campaignOrganizations, [LG_REFERRAL_ORGANIZATION_ID]);
  assert(!JSON.stringify(result).includes("insurance-demo"));
});

Deno.test("catalog has exact deterministic IDs, approved labels, and active status", async () => {
  const { result } = await call();
  assertEquals(result.services.map((service: { id: string }) => service.id), [
    "luis_compra_super",
    "luis_cupon_super",
    "luis_accidente",
    "luis_inmigracion",
    "luis_cupon_medico",
    "luis_cupon_dental",
    "luis_eventos",
    "luis_representante",
  ]);
  assertEquals(
    result.services.map((service: { name: string }) => service.name),
    [
      "Compras de supermercado",
      "Cupón de supermercado",
      "Accidente de auto",
      "Inmigración",
      "Cupón médico",
      "Cupón dental",
      "Eventos comunitarios",
      "Hablar con asesor",
    ],
  );
  assert(
    result.services.every((service: { active: boolean }) =>
      service.active === true
    ),
  );
});

Deno.test("campaign terms produce exact current public coupon descriptions", async () => {
  const { result } = await call();
  const descriptions = Object.fromEntries(
    result.services.map((service: { id: string; description: string }) => [
      service.id,
      service.description,
    ]),
  );
  assertEquals(
    descriptions.luis_cupon_super,
    "Mi Tierra: $10 de descuento en compras de $100 o más.",
  );
  assertEquals(
    descriptions.luis_cupon_medico,
    "Médico Urgencias: 20% de descuento.",
  );
  assertEquals(
    descriptions.luis_cupon_dental,
    "Dental Now 14: promoción de $29.",
  );
});

Deno.test("stale legacy labels never leak into voice response", async () => {
  const { result } = await call();
  const serialized = JSON.stringify(result);
  assert(!serialized.includes("$20"));
  assert(!serialized.includes("Donación de comida"));
  assert(!serialized.includes("Hablar con alguien"));
});

Deno.test("inactive non-coupon service is excluded", async () => {
  const { result } = await call(
    LG_REFERRAL_ORGANIZATION_ID,
    dependencies({
      services: serviceRows.map((row) =>
        row.id === "luis_eventos" ? { ...row, activo: false } : row
      ),
    }),
  );
  assertEquals(result.services.length, 7);
  assert(
    !result.services.some((service: { id: string }) =>
      service.id === "luis_eventos"
    ),
  );
});

Deno.test("inactive campaign and missing dental campaign are not fabricated", async () => {
  const inactive = await call(
    LG_REFERRAL_ORGANIZATION_ID,
    dependencies({
      campaigns: campaigns.map((campaign) =>
        campaign.service_id === "luis_cupon_super"
          ? { ...campaign, active: false }
          : campaign
      ),
    }),
  );
  assert(
    !inactive.result.services.some((service: { id: string }) =>
      service.id === "luis_cupon_super"
    ),
  );

  const missingDental = await call(
    LG_REFERRAL_ORGANIZATION_ID,
    dependencies({
      campaigns: campaigns.filter((campaign) =>
        campaign.service_id !== "luis_cupon_dental"
      ),
    }),
  );
  assert(
    !missingDental.result.services.some((service: { id: string }) =>
      service.id === "luis_cupon_dental"
    ),
  );
});

Deno.test("internal source tenants and private identifiers are not exposed", async () => {
  const { result } = await call(DEMO_REFERRAL_ORGANIZATION_ID);
  const serialized = JSON.stringify(result).toLowerCase();
  for (
    const forbidden of [
      NON_COUPON_SOURCE_ORGANIZATION_ID,
      COUPON_SOURCE_ORGANIZATION_ID,
      SECRET,
      "service_role",
      "public_token",
      "campaign_id",
      "page_id",
      "waba",
      "partner_id",
      "coupon_code",
    ]
  ) {
    assert(!serialized.includes(forbidden.toLowerCase()));
  }
});

Deno.test("content type and body size guards remain enforced", async () => {
  const wrongType = await handleVoiceToolRequest(
    request("{}", { contentType: "text/plain" }),
    dependencies().value,
  );
  assertEquals(wrongType.status, 415);
  const oversized = await handleVoiceToolRequest(
    request(JSON.stringify({
      action: "list_services",
      organization_id: LG_REFERRAL_ORGANIZATION_ID,
      padding: "x".repeat(5_000),
    })),
    dependencies().value,
  );
  assertEquals(oversized.status, 413);
});

Deno.test("source channel defaults to voice and rejects invalid values", async () => {
  const defaulted = await handleVoiceToolRequest(
    request({
      action: "list_services",
      organization_id: LG_REFERRAL_ORGANIZATION_ID,
    }),
    dependencies().value,
  );
  assertEquals(defaulted.status, 200);

  const invalid = await handleVoiceToolRequest(
    request({
      action: "list_services",
      organization_id: LG_REFERRAL_ORGANIZATION_ID,
      source_channel: "messenger",
    }),
    dependencies().value,
  );
  assertEquals(invalid.status, 400);
  assertEquals(await invalid.json(), {
    success: false,
    error: "invalid_source_channel",
  });
});

Deno.test("get_service_requirements supports LG and the explicit demo alias", async () => {
  for (
    const organizationId of [
      LG_REFERRAL_ORGANIZATION_ID,
      DEMO_REFERRAL_ORGANIZATION_ID,
    ]
  ) {
    const response = await handleVoiceToolRequest(
      request({
        action: "get_service_requirements",
        organization_id: organizationId,
        service_id: "luis_accidente",
      }),
      dependencies().value,
    );
    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.service_id, "luis_accidente");
    assertEquals(
      result.required_fields.map((field: { id: string }) => field.id),
      [
        "profile_name",
        "profile_city",
        "accident_date",
        "accident_city",
        "accident_injuries",
        "contact_name",
        "contact_phone",
      ],
    );
  }
});

Deno.test("requirements reject invalid and inactive services", async () => {
  const invalid = await handleVoiceToolRequest(
    request({
      action: "get_service_requirements",
      organization_id: LG_REFERRAL_ORGANIZATION_ID,
      service_id: "not-a-service",
    }),
    dependencies().value,
  );
  assertEquals(invalid.status, 404);
  assertEquals((await invalid.json()).error, "service_not_found");

  const inactive = await handleVoiceToolRequest(
    request({
      action: "get_service_requirements",
      organization_id: LG_REFERRAL_ORGANIZATION_ID,
      service_id: "luis_eventos",
    }),
    dependencies({
      services: serviceRows.map((row) =>
        row.id === "luis_eventos" ? { ...row, activo: false } : row
      ),
    }).value,
  );
  assertEquals(inactive.status, 409);
  assertEquals((await inactive.json()).error, "service_inactive");
});

Deno.test("non-grocery intake never invokes geocoding or route distance", async () => {
  let geocodeCalls = 0;
  let routeCalls = 0;
  const response = await handleVoiceToolRequest(
    request({
      action: "save_intake",
      organization_id: LG_REFERRAL_ORGANIZATION_ID,
      source_channel: "voice",
      service_id: "luis_accidente",
      conversation_id: "accident-no-distance",
      fields: { profile_name: "Persona de prueba" },
    }),
    {
      ...dependencies().value,
      workflow: {
        findVoiceLead: () => Promise.resolve({ data: null, error: null }),
        saveVoiceLead: (input: any) =>
          Promise.resolve({
            data: {
              id: crypto.randomUUID(),
              state: input.state,
              channel: input.sourceChannel,
              channel_user_id: input.channelUserId,
              service_id: input.serviceId,
            },
            error: null,
          }),
        getCampaign: () => Promise.resolve({ data: null, error: null }),
        issueCoupon: () => Promise.reject(new Error("coupon_not_expected")),
      },
      grocery: {
        listOffers: () => Promise.resolve({ data: [], error: null }),
        getOffer: () => Promise.resolve({ data: null, error: null }),
        listLocations: () => Promise.resolve({ data: [], error: null }),
        geocodeAddress: () => {
          geocodeCalls += 1;
          return Promise.resolve({ data: null, error: "unexpected" });
        },
        computeDrivingRouteMatrix: () => {
          routeCalls += 1;
          return Promise.resolve({ data: null, error: "unexpected" });
        },
        findVoiceLead: () => Promise.resolve({ data: null, error: null }),
        saveVoiceLead: () => Promise.resolve({ data: null, error: null }),
        createOrder: () => Promise.resolve({ data: null, error: null }),
      },
    } as any,
  );
  assertEquals(response.status, 200);
  assertEquals(geocodeCalls, 0);
  assertEquals(routeCalls, 0);
});
