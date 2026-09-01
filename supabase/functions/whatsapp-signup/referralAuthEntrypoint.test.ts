import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { resolveLoginReturnPath } from "../../../src/apps/referral-hub/auth/loginNavigation.ts";
import { mayStartWhatsAppEmbeddedSignup } from "../../../src/lib/whatsappConnectionState.ts";

const root = new URL("../../../", import.meta.url);

async function readSource(path: string) {
  return await Deno.readTextFile(new URL(path, root));
}

Deno.test("Conexxion protects the dashboard while keeping login public", async () => {
  const app = await readSource("src/apps/referral-hub/App.tsx");
  assertStringIncludes(app, 'path="/login" element={<ReferralLogin />}');
  assertStringIncludes(app, '<Navigate to="/login" replace state={{ from: location.pathname }} />');
  assertStringIncludes(app, '<RequireAuth><ReferralOrganizationProvider><BoltShell /></ReferralOrganizationProvider></RequireAuth>');
  assertEquals(app.includes('<AuthProvider><ReferralOrganizationProvider><ProductRoutes/></ReferralOrganizationProvider></AuthProvider>'), false);
});

Deno.test("login only returns to safe internal destinations", () => {
  assertEquals(resolveLoginReturnPath({ from: "/integrations" }), "/integrations");
  assertEquals(resolveLoginReturnPath({ from: "/" }), "/");
  assertEquals(resolveLoginReturnPath({ from: "https://outside.example" }), "/");
  assertEquals(resolveLoginReturnPath({ from: "//outside.example" }), "/");
  assertEquals(resolveLoginReturnPath(null), "/");
});

Deno.test("login, membership, logout, and mobile controls keep the Conexxion access contract", async () => {
  const [login, organization, settings] = await Promise.all([
    readSource("src/apps/referral-hub/pages/ReferralLogin.tsx"),
    readSource("src/apps/referral-hub/organizations/ReferralOrganizationContext.tsx"),
    readSource("src/apps/referral-hub/pages/ReferralSettings.tsx"),
  ]);
  assertStringIncludes(login, "ConexxionWordmark");
  assertStringIncludes(login, "Correo electrónico");
  assertStringIncludes(login, "Iniciar sesión");
  assertStringIncludes(login, "Mostrar contraseña");
  assertStringIncludes(login, "min-h-screen");
  assertStringIncludes(login, 'autoComplete="current-password"');
  assertStringIncludes(organization, "Tu cuenta no está asociada a una organización.");
  assertStringIncludes(organization, 'setError("")');
  assertStringIncludes(settings, 'navigate("/login", { replace: true })');
  assertEquals(mayStartWhatsAppEmbeddedSignup("owner"), true);
  assertEquals(mayStartWhatsAppEmbeddedSignup("admin"), true);
  assertEquals(mayStartWhatsAppEmbeddedSignup("member"), false);
});
