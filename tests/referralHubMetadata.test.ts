function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const indexHtml = await Deno.readTextFile(
  new URL("../index.html", import.meta.url),
);
const manifest = await Deno.readTextFile(
  new URL("../public/manifest.json", import.meta.url),
);
const referralApp = await Deno.readTextFile(
  new URL("../src/apps/referral-hub/App.tsx", import.meta.url),
);
const oauthButton = await Deno.readTextFile(
  new URL("../src/components/integrations/ConnectMessengerButton.tsx", import.meta.url),
);

Deno.test("standalone Referral Hub metadata uses only LG branding", () => {
  const metadata = `${indexHtml}\n${manifest}`;
  assert(
    /LG Community Network|Referral Hub/.test(metadata),
    "Referral Hub or LG Community branding is required",
  );
  for (const forbidden of [
    "DentalConnect",
    "Dental Connect",
    "BarberLine",
    "InsuranceLine",
  ]) {
    assert(!metadata.includes(forbidden), `${forbidden} must not appear in product metadata`);
  }
});

Deno.test("standalone Referral Hub metadata uses the production canonical URL", () => {
  assert(
    indexHtml.includes('<link rel="canonical" href="https://referral.creatyv.io/" />'),
    "canonical URL must be https://referral.creatyv.io/",
  );
  assert(
    indexHtml.includes('<meta property="og:url" content="https://referral.creatyv.io/" />'),
    "Open Graph URL must be https://referral.creatyv.io/",
  );
});

Deno.test("Messenger OAuth callback route remains unchanged", () => {
  assert(
    referralApp.includes('path="/auth/meta/callback"'),
    "Referral app must expose /auth/meta/callback",
  );
  assert(
    oauthButton.includes('`${APP_URL}/auth/meta/callback`'),
    "Messenger OAuth must continue generating /auth/meta/callback",
  );
});
