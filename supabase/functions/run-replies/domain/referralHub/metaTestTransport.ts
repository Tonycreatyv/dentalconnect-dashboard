export const META_TEST_DEMO_ORGANIZATION_ID = "luis-gabriel-referral-hub";
export const META_TEST_DEMO_ROUTE_TYPE = "meta_test_demo";
export const META_TEST_DEMO_PHONE_NUMBER_ID = "1185864697945379";

type TestTransportInput = {
  organizationId: string;
  channel: string;
  payload: Record<string, unknown> | null | undefined;
  configuredAccessToken: string;
  configuredPhoneNumberId: string;
  testAccessToken: string;
  testDemoEnabled: boolean;
};

export function isMetaTestTransport(input: Omit<TestTransportInput, "configuredAccessToken" | "configuredPhoneNumberId" | "testAccessToken">) {
  const inboundPhone = String(input.payload?.inbound_phone_number_id ?? "").trim();
  const routeType = String(input.payload?.whatsapp_route_type ?? "").trim();
  return input.organizationId === META_TEST_DEMO_ORGANIZATION_ID &&
    input.channel === "whatsapp" &&
    (inboundPhone === META_TEST_DEMO_PHONE_NUMBER_ID || routeType === META_TEST_DEMO_ROUTE_TYPE);
}

/**
 * An exact TEST-phone job can never fall back to a tenant credential. If the
 * canonical TEST secret is missing, return no credential and fail closed.
 */
export function selectWhatsAppTransport(input: TestTransportInput) {
  const testTransport = isMetaTestTransport(input);
  if (testTransport) {
    return {
      isTestTransport: true,
      accessToken: input.testAccessToken,
      phoneNumberId: META_TEST_DEMO_PHONE_NUMBER_ID,
      credentialSource: input.testAccessToken
        ? "META_WHATSAPP_TEST_ACCESS_TOKEN"
        : "META_WHATSAPP_TEST_ACCESS_TOKEN_MISSING",
    } as const;
  }
  return {
    isTestTransport: false,
    accessToken: input.configuredAccessToken,
    phoneNumberId: input.configuredPhoneNumberId,
    credentialSource: "CONFIGURED_WHATSAPP_CREDENTIAL",
  } as const;
}
