import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  META_TEST_DEMO_PHONE_NUMBER_ID,
  selectWhatsAppTransport,
} from "../domain/referralHub/metaTestTransport.ts";

const base = {
  organizationId: "luis-gabriel-referral-hub",
  channel: "whatsapp",
  configuredAccessToken: "LUIS_ORG_TOKEN",
  configuredPhoneNumberId: "1287679991091560",
  testAccessToken: "TEST_TOKEN",
  testDemoEnabled: true,
};

Deno.test("exact TEST phone always selects the canonical TEST credential", () => {
  const selected = selectWhatsAppTransport({
    ...base,
    payload: { inbound_phone_number_id: META_TEST_DEMO_PHONE_NUMBER_ID },
  });
  assertEquals(selected.credentialSource, "META_WHATSAPP_TEST_ACCESS_TOKEN");
  assertEquals(selected.accessToken, "TEST_TOKEN");
  assertEquals(selected.phoneNumberId, META_TEST_DEMO_PHONE_NUMBER_ID);
});

Deno.test("an org credential cannot override the TEST transport", () => {
  const selected = selectWhatsAppTransport({
    ...base,
    configuredAccessToken: "WRONG_ORG_TOKEN",
    payload: { inbound_phone_number_id: META_TEST_DEMO_PHONE_NUMBER_ID },
  });
  assertEquals(selected.accessToken, "TEST_TOKEN");
});

Deno.test("missing TEST credential fails closed instead of falling back", () => {
  const selected = selectWhatsAppTransport({
    ...base,
    testAccessToken: "",
    payload: { inbound_phone_number_id: META_TEST_DEMO_PHONE_NUMBER_ID },
  });
  assertEquals(selected.credentialSource, "META_WHATSAPP_TEST_ACCESS_TOKEN_MISSING");
  assertEquals(selected.accessToken, "");
});

Deno.test("Luis production phone retains configured credential behavior", () => {
  const selected = selectWhatsAppTransport({
    ...base,
    payload: { inbound_phone_number_id: "1287679991091560" },
  });
  assertEquals(selected.credentialSource, "CONFIGURED_WHATSAPP_CREDENTIAL");
  assertEquals(selected.accessToken, "LUIS_ORG_TOKEN");
  assertEquals(selected.phoneNumberId, "1287679991091560");
});
