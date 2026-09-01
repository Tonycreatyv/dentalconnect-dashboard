import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  handleReferralHubTurn,
  type ReferralHubServiceConfig,
} from "../domain/referralHub/genericMenuRouter.ts";

const organizationId = "luis-gabriel-referral-hub";
const leadState = {
  collected: {
    referral_hub: {
      profile_name: "Luis Gabriel",
      profile_city: "Atlanta",
      profile_complete: true,
    },
  },
};

function config(
  id: string,
  order: number,
  active = true,
  label = id,
): ReferralHubServiceConfig {
  return {
    id,
    organization_id: organizationId,
    nombre: label,
    menu_label: label,
    menu_orden: order,
    activo: active,
    tipo: "static_action",
  };
}

const services = [
  config("luis_compra_super", 1, true, "Compras y delivery"),
  config("luis_accidente", 2, true, "Accidentes"),
  config("luis_inmigracion", 3, true, "Inmigración"),
  config("luis_cupon_super", 4, true, "Cupón supermercado"),
  config("luis_cupon_medico", 5, true, "Beneficio médico"),
  config("luis_cupon_dental", 6, true, "Dentista"),
  config("luis_eventos", 7, false, "Eventos comunitarios"),
];

async function menu(
  serviceConfigs?: ReferralHubServiceConfig[],
  payloadAction?: string,
  supabase?: any,
) {
  return await handleReferralHubTurn({
    organizationId,
    leadState,
    inboundText: "",
    payloadAction,
    channel: "whatsapp",
    serviceConfigs,
    supabase,
  });
}

Deno.test("canonical menu prioritizes medical, dental, accidents, and supermarket", async () => {
  const result = await menu(services);
  const rows = result.interactiveList?.sections[0].rows ?? [];
  assertEquals(rows.map((row) => row.title), [
    "Cupón médico",
    "Cupón dental",
    "Accidentes",
    "Supermercado",
    "Ver más servicios",
    "Hablar con asesor",
  ]);
  assertEquals(rows.some((row) => row.title === "Eventos comunitarios"), false);
});

Deno.test("canonical more-services menu preserves remaining available services", async () => {
  const result = await menu(services, "referral_menu:more");
  assertEquals(result.debugNote, "referral_hub:lg_menu_more");
  assertEquals(
    result.interactiveList?.sections[0].rows.map((row) => row.title),
    ["Inmigración", "Cupón supermercado"],
  );
});

Deno.test("stored menu order remains available for secondary services", async () => {
  const reordered = services.map((service) =>
    service.id === "luis_cupon_super"
      ? { ...service, menu_orden: 1 }
      : { ...service, menu_orden: service.menu_orden! + 1 }
  );
  const result = await menu(reordered, "referral_menu:more");
  assertEquals(
    result.interactiveList?.sections[0].rows.map((row) => row.title),
    ["Cupón supermercado", "Inmigración"],
  );
});

Deno.test("missing config falls back safely while all-disabled config does not re-enable services", async () => {
  const missing = await menu(undefined, undefined, {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: null,
              error: { message: "relation unavailable" },
            }),
        }),
      }),
    }),
  });
  assertEquals(missing.interactiveList?.sections[0].rows.length, 8);
  const disabled = await menu(
    services.map((service) => ({ ...service, activo: false })),
  );
  assertEquals(disabled.debugNote, "referral_hub:lg_menu_no_active_services");
  assertStringIncludes(disabled.reply, "no hay servicios disponibles");
  assertEquals(disabled.interactiveList, undefined);
});

Deno.test("canonical menu configuration remains organization scoped and grocery direct entry bypasses it", async () => {
  const filters: Array<[string, unknown]> = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: (field: string, value: unknown) => {
          filters.push([field, value]);
          return {
            order: () => Promise.resolve({ data: services, error: null }),
          };
        },
      }),
    }),
  };
  const result = await handleReferralHubTurn({
    organizationId,
    leadState,
    inboundText: "",
    channel: "whatsapp",
    supabase: client as any,
  });
  assert(
    filters.some(([field, value]) =>
      field === "organization_id" && value === organizationId
    ),
  );
  assertEquals(
    result.interactiveList?.sections[0].rows[0].title,
    "Cupón médico",
  );
  const injected = await menu([{
    ...config("luis_representante", 0, true, "Otro tenant"),
    organization_id: "other-organization",
  }, ...services]);
  assertEquals(
    injected.interactiveList?.sections[0].rows[0].title,
    "Cupón médico",
  );
  const grocery = await handleReferralHubTurn({
    organizationId,
    leadState,
    inboundText: "",
    payloadAction: "referral_service:luis_compra_super",
    channel: "whatsapp",
  });
  assertEquals(grocery.debugNote, "referral_hub:grocery_entry");
  assertEquals(grocery.interactiveButtons?.map((button) => button.title), [
    "Quiero mi cupón",
    "Ver las canastas",
  ]);
});

Deno.test("live service-config projection retains organization scope before canonical filtering", async () => {
  let selectedColumns = "";
  const client = {
    from: () => ({
      select: (columns: string) => {
        selectedColumns = columns;
        return {
          eq: () => ({
            order: () => Promise.resolve({ data: services, error: null }),
          }),
        };
      },
    }),
  };

  const result = await handleReferralHubTurn({
    organizationId,
    leadState,
    inboundText: "menu",
    channel: "whatsapp",
    supabase: client as any,
  });

  assert(selectedColumns.split(",").includes("organization_id"));
  assertEquals(result.debugNote, "referral_hub:lg_menu");
  assertEquals(
    result.interactiveList?.sections[0].rows[0].title,
    "Cupón médico",
  );
  assert(!result.reply.includes("no hay servicios disponibles"));
});
