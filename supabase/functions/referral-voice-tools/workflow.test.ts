import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  getServiceRequirements,
  issueVoiceCoupon,
  normalizePhone,
  saveVoiceIntake,
  submitVoiceRequest,
  VOICE_SERVICE_WORKFLOWS,
  VOICE_SOURCE_ORGANIZATION_ID,
  type VoiceLead,
  type VoiceLeadInput,
  type VoiceWorkflowDependencies,
} from "./workflow.ts";

function fakeWorkflow() {
  const leads = new Map<string, VoiceLead>();
  const savedInputs: VoiceLeadInput[] = [];
  const couponCodes = new Map<string, string>();
  let issueCalls = 0;
  const campaigns = new Map([
    [
      "luis_cupon_super",
      {
        service_id: "luis_cupon_super",
        campaign_key: "mi_tierra_10",
        display_name: "Mi Tierra — cupón $10",
        offer_terms: { discount_amount: 10, minimum_purchase: 100 },
        active: true,
      },
    ],
    [
      "luis_cupon_medico",
      {
        service_id: "luis_cupon_medico",
        campaign_key: "medico_urgencias_20",
        display_name: "Médico Urgencias — 20%",
        offer_terms: { discount_percent: 20 },
        active: true,
      },
    ],
    [
      "luis_cupon_dental",
      {
        service_id: "luis_cupon_dental",
        campaign_key: "dental_now_14_29",
        display_name: "Dental Now 14 — $29",
        offer_terms: { promotional_price: 29 },
        active: true,
      },
    ],
  ]);
  const dependencies: VoiceWorkflowDependencies = {
    findVoiceLead: (channelUserId, sourceChannel) =>
      Promise.resolve({
        data: leads.get(`${sourceChannel}:${channelUserId}`) ?? null,
        error: null,
      }),
    saveVoiceLead: (input) => {
      savedInputs.push(input);
      const key = `${input.sourceChannel}:${input.channelUserId}`;
      const current = leads.get(key);
      const lead: VoiceLead = {
        id: current?.id ?? crypto.randomUUID(),
        state: input.state,
        channel: input.sourceChannel,
        channel_user_id: input.channelUserId,
        service_id: input.serviceId,
        handoff_to_human: input.handoffToHuman ?? false,
        status: input.status ?? "contacted",
      };
      leads.set(key, lead);
      return Promise.resolve({ data: lead, error: null });
    },
    getCampaign: (serviceId) =>
      Promise.resolve({
        data: campaigns.get(serviceId) ?? null,
        error: null,
      }),
    issueCoupon: ({ leadId, campaignKey }) => {
      issueCalls += 1;
      const key = `${leadId}:${campaignKey}`;
      const code = couponCodes.get(key) ?? `LG-${campaignKey}-FIXED`;
      couponCodes.set(key, code);
      return Promise.resolve({
        id: "private-id",
        code,
        publicUrl: "https://example.test/private",
        status: "active",
        issuedAt: "2026-07-28T00:00:00.000Z",
        expiresAt: null,
        wasCreated: issueCalls === 1,
      });
    },
  };
  return {
    campaigns,
    dependencies,
    leads,
    savedInputs,
    get issueCalls() {
      return issueCalls;
    },
  };
}

const base = {
  organization_id: "luis-gabriel-referral-hub",
  conversation_id: "elevenlabs-conversation-1",
};

Deno.test("requirements expose the exact canonical fields for all eight services", () => {
  const expected: Record<string, string[]> = {
    luis_compra_super: [
      "offer_id",
      "postal_code",
      "partner_location_id",
      "customer_name",
      "phone",
      "address_line_1",
      "city",
      "state",
      "payment_preference",
    ],
    luis_accidente: [
      "profile_name",
      "profile_city",
      "accident_date",
      "accident_city",
      "accident_injuries",
      "contact_name",
      "contact_phone",
    ],
    luis_inmigracion: [
      "profile_name",
      "profile_city",
      "immigration_case",
    ],
    luis_cupon_medico: ["profile_name", "profile_city"],
    luis_cupon_super: ["profile_name", "profile_city"],
    luis_cupon_dental: ["profile_name", "profile_city"],
    luis_eventos: ["profile_name", "profile_city"],
    luis_representante: ["profile_name", "profile_city"],
  };
  assertEquals(VOICE_SERVICE_WORKFLOWS.length, 8);
  for (const [serviceId, fields] of Object.entries(expected)) {
    const result = getServiceRequirements(serviceId);
    assert(result);
    assertEquals(
      result.required_fields.map((field) => field.id),
      fields,
    );
  }
});

Deno.test("incremental intake preserves fields and reports the next field", async () => {
  const fake = fakeWorkflow();
  const first = await saveVoiceIntake({
    ...base,
    service_id: "luis_inmigracion",
    fields: { profile_name: "Ana López" },
  }, fake.dependencies);
  assert("body" in first);
  assertEquals((first as any).body.next_field?.id, "profile_city");
  const second = await saveVoiceIntake({
    ...base,
    service_id: "luis_inmigracion",
    fields: { profile_city: "Atlanta" },
  }, fake.dependencies);
  assert("body" in second);
  assertEquals((second as any).body.next_field?.id, "immigration_case");
  assertEquals(
    fake.savedInputs.at(-1)?.organizationId,
    VOICE_SOURCE_ORGANIZATION_ID,
  );
});

Deno.test("field allowlists and phone normalization are strict", async () => {
  assertEquals(normalizePhone("(404) 555-1212"), "+4045551212");
  assertEquals(normalizePhone("not a phone"), null);
  const fake = fakeWorkflow();
  const invalid = await saveVoiceIntake({
    ...base,
    service_id: "luis_accidente",
    fields: { social_security_number: "123" },
  }, fake.dependencies);
  assertEquals(invalid.error, "invalid_field");
  const phone = await saveVoiceIntake({
    ...base,
    caller_phone: "(404) 555-1212",
    service_id: "luis_accidente",
    fields: { profile_name: "Ana López" },
  }, fake.dependencies);
  assert("body" in phone);
  assert(
    JSON.stringify(fake.savedInputs.at(-1)?.state).includes("+4045551212"),
  );

  const date = await saveVoiceIntake({
    ...base,
    service_id: "luis_accidente",
    fields: { accident_date: "2026-07-20" },
  }, fake.dependencies);
  assert("body" in date);
  assert(
    JSON.stringify(fake.savedInputs.at(-1)?.state).includes("2026-07-20"),
  );
});

Deno.test("browser flow works without fabricating a caller phone", async () => {
  const fake = fakeWorkflow();
  const result = await saveVoiceIntake({
    ...base,
    service_id: "luis_eventos",
    fields: { profile_name: "Ana López", profile_city: "Atlanta" },
  }, fake.dependencies);
  assert("body" in result);
  const serialized = JSON.stringify(fake.savedInputs.at(-1)?.state);
  assert(!serialized.includes("caller_phone"));
  assert(fake.savedInputs.at(-1)?.channelUserId.startsWith("voice:"));
});

Deno.test("missing source defaults to voice and explicit channels remain separate", async () => {
  const fake = fakeWorkflow();
  await saveVoiceIntake({
    ...base,
    source_channel: "voice",
    service_id: "luis_inmigracion",
    fields: { profile_name: "Ana López" },
  }, fake.dependencies);
  await saveVoiceIntake({
    ...base,
    service_id: "luis_inmigracion",
    fields: { profile_city: "Atlanta", immigration_case: "Residencia" },
  }, fake.dependencies);
  assertEquals(fake.leads.size, 1);
  await saveVoiceIntake({
    ...base,
    source_channel: "whatsapp",
    service_id: "luis_inmigracion",
    fields: { profile_name: "Beatriz", profile_city: "Norcross" },
  }, fake.dependencies);
  assertEquals(fake.leads.size, 2);
  assertEquals(fake.savedInputs.map((input) => input.sourceChannel), [
    "voice",
    "voice",
    "whatsapp",
  ]);
  assertEquals(
    new Set(fake.savedInputs.map((input) => input.channelUserId)).size,
    1,
  );
  assertEquals(fake.savedInputs[0].state.channel, "voice");
  assertEquals(fake.savedInputs[2].state.channel, "whatsapp");
});

Deno.test("invalid source channel is rejected before persistence", async () => {
  const fake = fakeWorkflow();
  const result = await saveVoiceIntake({
    ...base,
    source_channel: "messenger",
    service_id: "luis_eventos",
    fields: { profile_name: "Ana López" },
  }, fake.dependencies);
  assertEquals(result.error, "invalid_source_channel");
  assertEquals(fake.savedInputs.length, 0);
  assertEquals(fake.leads.size, 0);
});

Deno.test("all request services persist and repeated submissions are idempotent", async () => {
  const cases = [
    {
      id: "luis_accidente",
      fields: {
        profile_name: "Ana López",
        profile_city: "Atlanta",
        accident_date: "2026-07-20",
        accident_city: "Atlanta",
        accident_injuries: "no",
        contact_name: "Ana López",
        contact_phone: "+14045551212",
      },
      handoff: true,
    },
    {
      id: "luis_inmigracion",
      fields: {
        profile_name: "Ana López",
        profile_city: "Atlanta",
        immigration_case: "Residencia",
      },
      handoff: false,
    },
    {
      id: "luis_eventos",
      fields: { profile_name: "Ana López", profile_city: "Atlanta" },
      handoff: false,
    },
    {
      id: "luis_representante",
      fields: { profile_name: "Ana López", profile_city: "Atlanta" },
      handoff: true,
    },
  ];
  for (const [index, item] of cases.entries()) {
    const fake = fakeWorkflow();
    const request = {
      ...base,
      conversation_id: `conversation-${index}`,
      service_id: item.id,
      fields: item.fields,
    };
    await saveVoiceIntake(request, fake.dependencies);
    const submitted = await submitVoiceRequest({
      ...request,
      confirmed: true,
    }, fake.dependencies);
    assert("body" in submitted);
    assertEquals((submitted as any).body.submitted, true);
    assertEquals(fake.savedInputs.at(-1)?.handoffToHuman, item.handoff);
    const savedState = JSON.stringify(fake.savedInputs.at(-1)?.state);
    assertEquals(
      savedState.includes('"handoff_status":"created"'),
      item.handoff,
    );
    const saveCount = fake.savedInputs.length;
    const repeated = await submitVoiceRequest({
      ...request,
      confirmed: true,
    }, fake.dependencies);
    assert("body" in repeated);
    assertEquals(fake.savedInputs.length, saveCount);
  }
});

Deno.test("submission requires confirmation and complete persisted intake", async () => {
  const fake = fakeWorkflow();
  const unconfirmed = await submitVoiceRequest({
    ...base,
    service_id: "luis_eventos",
    confirmed: false,
  }, fake.dependencies);
  assertEquals(unconfirmed.error, "confirmation_required");
  const missing = await submitVoiceRequest({
    ...base,
    service_id: "luis_eventos",
    confirmed: true,
  }, fake.dependencies);
  assertEquals(missing.error, "missing_required_fields");
});

Deno.test("three real campaigns issue persistent non-fabricated coupons", async () => {
  for (
    const serviceId of [
      "luis_cupon_medico",
      "luis_cupon_super",
      "luis_cupon_dental",
    ]
  ) {
    const fake = fakeWorkflow();
    const request = {
      ...base,
      conversation_id: `coupon-${serviceId}`,
      service_id: serviceId,
      fields: { profile_name: "Ana López", profile_city: "Atlanta" },
      confirmed: true,
    };
    const first = await issueVoiceCoupon(request, fake.dependencies);
    const second = await issueVoiceCoupon(request, fake.dependencies);
    assert("body" in first && "body" in second);
    assertEquals(
      (first as any).body.coupon_code,
      (second as any).body.coupon_code,
    );
    assertEquals((first as any).body.issued, true);
    const serialized = JSON.stringify((first as any).body);
    assert(!serialized.includes("$20"));
    assert(!serialized.includes("private-id"));
    assert(!serialized.includes("public_token"));
  }
});

Deno.test("missing campaign and failed issuance return truthful errors", async () => {
  const missing = fakeWorkflow();
  missing.campaigns.delete("luis_cupon_super");
  const body = {
    ...base,
    service_id: "luis_cupon_super",
    fields: { profile_name: "Ana López", profile_city: "Atlanta" },
    confirmed: true,
  };
  const absent = await issueVoiceCoupon(body, missing.dependencies);
  assertEquals((absent as any).error, "campaign_not_found");

  const failed = fakeWorkflow();
  failed.dependencies.issueCoupon = () =>
    Promise.reject(new Error("database details"));
  const result = await issueVoiceCoupon(body, failed.dependencies);
  assertEquals((result as any).error, "coupon_issuance_failed");
  assert(!JSON.stringify(result).includes("database details"));
});
