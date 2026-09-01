/// <reference lib="deno.ns" />
// 2026-08-27: native WhatsApp location message support, added specifically
// to replace the raw pasted Google Maps URL in the nearest-supermarket
// proposal. buildWhatsAppLocationMessage is a pure payload builder (same
// pattern as the pre-existing buildWhatsAppFlowCtaMessage), so it's tested
// directly here without needing to mock global fetch.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildWhatsAppLocationMessage } from "../../_shared/metaMessageAdapter.ts";

Deno.test("buildWhatsAppLocationMessage builds a real WhatsApp Cloud API location message, verbatim from the caller's own coordinates/name/address", () => {
  const message = buildWhatsAppLocationMessage({
    to: "15551234567",
    location: {
      latitude: 33.9539,
      longitude: -84.1854,
      name: "El Sol Super Market",
      address: "2880 Simpson Cir #110, Norcross, GA 30071",
    },
  });
  assertEquals(message, {
    messaging_product: "whatsapp",
    to: "15551234567",
    type: "location",
    location: {
      latitude: 33.9539,
      longitude: -84.1854,
      name: "El Sol Super Market",
      address: "2880 Simpson Cir #110, Norcross, GA 30071",
    },
  });
});

Deno.test("buildWhatsAppLocationMessage never invents coordinates - latitude/longitude pass through exactly as given, never rounded or defaulted", () => {
  const message = buildWhatsAppLocationMessage({
    to: "1",
    location: { latitude: 34.29001234, longitude: -83.85009876, name: "Store", address: "Addr" },
  });
  const location = (message as any).location;
  assertEquals(location.latitude, 34.29001234);
  assertEquals(location.longitude, -83.85009876);
});

Deno.test("buildWhatsAppLocationMessage trims name/address but never fabricates a value when empty", () => {
  const message = buildWhatsAppLocationMessage({
    to: " 1 ",
    location: { latitude: 1, longitude: 2, name: "  Store  ", address: "" },
  });
  assertEquals((message as any).to, "1");
  assertEquals((message as any).location.name, "Store");
  assertEquals((message as any).location.address, "");
});
