import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";

const root = new URL("../../../", import.meta.url);

async function readSource(path: string) {
  return await Deno.readTextFile(new URL(path, root));
}

Deno.test("Conexxion branding uses the graphite wordmark across public product entry points", async () => {
  const [wordmark, shell, login, qrEntry, coupon, html, main, styles] = await Promise.all([
    readSource("src/apps/referral-hub/ui/ConexxionWordmark.tsx"),
    readSource("src/apps/referral-hub/ui/BoltShell.tsx"),
    readSource("src/apps/referral-hub/pages/ReferralLogin.tsx"),
    readSource("src/apps/referral-hub/pages/ReferralQrEntry.tsx"),
    readSource("src/pages/referral/CouponValidator.tsx"),
    readSource("index.html"),
    readSource("src/main.tsx"),
    readSource("src/index.css"),
  ]);

  assertStringIncludes(wordmark, "Cone");
  assertStringIncludes(wordmark, "conexxion-wordmark-xx");
  assertStringIncludes(shell, "ConexxionWordmark");
  assertStringIncludes(shell, "Cargando Conexxion");
  assertStringIncludes(login, "ConexxionWordmark");
  assertStringIncludes(qrEntry, "Conexxion ·");
  assertStringIncludes(coupon, ">Conexxion<");
  assertStringIncludes(html, "Conexxion | LG Community Network");
  assertStringIncludes(main, "Conexxion | LG Community Network");
  assertStringIncludes(styles, ".conexxion-wordmark");
  assertStringIncludes(styles, "--bolt-bg:#111315");
  assertStringIncludes(styles, "--bolt-surface:#181B1F");
  assertStringIncludes(styles, "--bolt-elevated:#20242A");
  assertStringIncludes(styles, "--bolt-border:#2A2E33");
  assertStringIncludes(styles, "--bolt-muted:#9CA3AA");
  assertStringIncludes(styles, "#C9CED6");
});

Deno.test("Conexxion branding preserves the canonical WhatsApp embedded signup bridge", async () => {
  const [integrations, signup] = await Promise.all([
    readSource("src/apps/referral-hub/pages/ReferralIntegrations.tsx"),
    readSource("src/components/WhatsAppConnect.tsx"),
  ]);

  assertStringIncludes(integrations, "WhatsAppConnect");
  assertStringIncludes(signup, 'invoke("whatsapp-signup"');
  assertStringIncludes(signup, "window.FB.login");
  assertEquals(signup.includes("2017373949"), false);
});
