/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendViaMetaAdapter } from "./metaMessageAdapter.ts";

Deno.test("WhatsApp CTA URL uses the native one-button interactive contract", async () => {
  let sent: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ messages: [{ id: "wamid.test" }] });
  };
  try {
    const result = await sendViaMetaAdapter({
      channel: "whatsapp", graphVersion: "v22.0", recipientId: "15555550100",
      text: "Compras listas para vos 👇", whatsappPhoneNumberId: "phone-id", whatsappAccessToken: "token",
      ctaUrl: { displayText: "Ver Mercadito", url: "https://compras.creatyv.io" },
    });
    assertEquals(result.ok, true);
    assertEquals(sent, {
      messaging_product: "whatsapp", to: "15555550100", type: "interactive",
      interactive: {
        type: "cta_url", body: { text: "Compras listas para vos 👇" },
        action: { name: "cta_url", parameters: { display_text: "Ver Mercadito", url: "https://compras.creatyv.io" } },
      },
    });
  } finally { globalThis.fetch = originalFetch; }
});
