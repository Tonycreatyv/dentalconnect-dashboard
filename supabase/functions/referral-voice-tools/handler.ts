export const LG_REFERRAL_ORGANIZATION_ID = "luis-gabriel-referral-hub";
export const DEMO_REFERRAL_ORGANIZATION_ID = "creatyv-referral-demo";
export const NON_COUPON_SOURCE_ORGANIZATION_ID = "luis-gabriel-referral-hub";
export const COUPON_SOURCE_ORGANIZATION_ID = "luis-gabriel-referral-hub";

const MAX_BODY_BYTES = 4_096;
const ALLOWED_ORGANIZATIONS = new Set([
  DEMO_REFERRAL_ORGANIZATION_ID,
  LG_REFERRAL_ORGANIZATION_ID,
]);

type VoiceServiceType = "information" | "coupon" | "handoff";

type ServiceMetadata = {
  id: string;
  name: string;
  type: VoiceServiceType;
  description?: string;
};

const SERVICE_ORDER: ServiceMetadata[] = [
  {
    id: "luis_compra_super",
    name: "Compras de supermercado",
    type: "information",
    description: "Compras preparadas con entrega según el área disponible.",
  },
  {
    id: "luis_cupon_super",
    name: "Cupón de supermercado",
    type: "coupon",
  },
  {
    id: "luis_accidente",
    name: "Accidente de auto",
    type: "information",
    description: "Orientación inicial después de un accidente de auto.",
  },
  {
    id: "luis_inmigracion",
    name: "Inmigración",
    type: "information",
    description: "Orientación inicial y conexión con recursos de inmigración.",
  },
  { id: "luis_cupon_medico", name: "Cupón médico", type: "coupon" },
  { id: "luis_cupon_dental", name: "Cupón dental", type: "coupon" },
  {
    id: "luis_eventos",
    name: "Eventos comunitarios",
    type: "information",
    description: "Información sobre eventos comunitarios disponibles.",
  },
  {
    id: "luis_representante",
    name: "Hablar con asesor",
    type: "handoff",
    description: "Solicitud de contacto con un asesor.",
  },
];

export type ServiceConfigRow = {
  id: string;
  activo: boolean;
};

export type CouponCampaignRow = {
  service_id: string;
  active: boolean;
  offer_terms: Record<string, unknown> | null;
};

export type VoiceService = {
  id: string;
  name: string;
  description: string;
  type: VoiceServiceType;
  active: true;
};

type SourceResult<T> = {
  data: T[] | null;
  error: unknown | null;
};

export type VoiceToolDependencies = {
  expectedSecret: string;
  listActiveNonCouponServices: (
    sourceOrganizationId: string,
  ) => Promise<SourceResult<ServiceConfigRow>>;
  listActiveCouponCampaigns: (
    sourceOrganizationId: string,
  ) => Promise<SourceResult<CouponCampaignRow>>;
  workflow?: import("./workflow.ts").VoiceWorkflowDependencies;
  grocery?: import("./grocery.ts").GroceryDependencies;
  couponDelivery?: import("./couponDelivery.ts").CouponDeliveryDependencies;
  log?: (event: Record<string, unknown>) => void;
};

function json(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function error(status: number, code: string) {
  return json(status, { success: false, error: code });
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function couponDescription(row: CouponCampaignRow): string | null {
  const terms = row.offer_terms ?? {};
  if (row.service_id === "luis_cupon_super") {
    const amount = finiteNumber(terms.discount_amount);
    const minimum = finiteNumber(terms.minimum_purchase);
    return amount !== null && minimum !== null
      ? `Mi Tierra: $${amount} de descuento en compras de $${minimum} o más.`
      : null;
  }
  if (row.service_id === "luis_cupon_medico") {
    const percent = finiteNumber(terms.discount_percent);
    return percent !== null
      ? `Médico Urgencias: ${percent}% de descuento.`
      : null;
  }
  if (row.service_id === "luis_cupon_dental") {
    const price = finiteNumber(terms.promotional_price);
    return price !== null ? `Dental Now 14: promoción de $${price}.` : null;
  }
  return null;
}

function projectServices(
  serviceRows: ServiceConfigRow[],
  campaignRows: CouponCampaignRow[],
): VoiceService[] {
  const activeServiceIds = new Set(
    serviceRows
      .filter((row) => row.activo === true)
      .map((row) => String(row.id).trim()),
  );
  const activeCampaigns = new Map(
    campaignRows
      .filter((row) => row.active === true)
      .map((row) => [String(row.service_id).trim(), row]),
  );

  return SERVICE_ORDER.flatMap((metadata) => {
    if (metadata.type === "coupon") {
      const campaign = activeCampaigns.get(metadata.id);
      if (!campaign) return [];
      const description = couponDescription(campaign);
      if (!description) return [];
      return [{ ...metadata, description, active: true as const }];
    }
    if (!activeServiceIds.has(metadata.id) || !metadata.description) return [];
    return [{
      ...metadata,
      description: metadata.description,
      active: true as const,
    }];
  });
}

export async function handleVoiceToolRequest(
  request: Request,
  dependencies: VoiceToolDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-headers": "content-type, x-creatyv-voice-secret",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-max-age": "600",
        vary: "Access-Control-Request-Headers",
      },
    });
  }
  if (request.method !== "POST") return error(405, "method_not_allowed");

  const providedSecret = request.headers.get("x-creatyv-voice-secret") ?? "";
  if (
    !providedSecret ||
    !dependencies.expectedSecret ||
    !timingSafeEqual(providedSecret, dependencies.expectedSecret)
  ) {
    return error(401, "unauthorized");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return error(415, "unsupported_media_type");
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return error(413, "request_too_large");
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return error(400, "malformed_json");
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return error(413, "request_too_large");
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return error(400, "malformed_json");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return error(400, "malformed_json");
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action) return error(400, "missing_action");
  const allowedActions = new Set([
    "list_services",
    "get_service_requirements",
    "save_intake",
    "submit_service_request",
    "issue_coupon",
    "list_basket_offers",
    "get_basket_details",
    "check_delivery_zip",
    "find_nearest_supermarket",
    "save_basket_intake",
    "create_basket_order",
    "deliver_coupon_image",
  ]);
  if (!allowedActions.has(action)) return error(400, "unsupported_action");

  const organizationId = typeof body.organization_id === "string"
    ? body.organization_id.trim()
    : "";
  if (!organizationId) return error(400, "missing_organization_id");
  if (!ALLOWED_ORGANIZATIONS.has(organizationId)) {
    return error(403, "organization_forbidden");
  }

  const { normalizeSourceChannel } = await import("./workflow.ts");
  const sourceChannel = normalizeSourceChannel(body.source_channel);
  if (!sourceChannel) return error(400, "invalid_source_channel");
  body.source_channel = sourceChannel;

  const groceryActions = new Set([
    "list_basket_offers",
    "get_basket_details",
    "check_delivery_zip",
    "find_nearest_supermarket",
    "save_basket_intake",
    "create_basket_order",
  ]);
  if (groceryActions.has(action)) {
    if (!dependencies.grocery) return error(500, "service_unavailable");
    const {
      checkDeliveryZip,
      createBasketOrder,
      findNearestSupermarket,
      getBasketDetails,
      listBasketOffers,
      saveBasketIntake,
    } = await import("./grocery.ts");
    const result = action === "list_basket_offers"
      ? await listBasketOffers(body.partner_location_id, dependencies.grocery)
      : action === "get_basket_details"
      ? await getBasketDetails(
        body.offer_id,
        body.partner_location_id,
        dependencies.grocery,
      )
      : action === "check_delivery_zip"
      ? await checkDeliveryZip(body.postal_code, dependencies.grocery)
      : action === "find_nearest_supermarket"
      ? await findNearestSupermarket(body, dependencies.grocery)
      : action === "save_basket_intake"
      ? await saveBasketIntake(body, dependencies.grocery)
      : await createBasketOrder(body, dependencies.grocery);
    return "body" in result && result.body
      ? json(result.status, result.body)
      : error(result.status, result.error ?? "service_unavailable");
  }

  if (action === "deliver_coupon_image") {
    if (!dependencies.couponDelivery) {
      return error(500, "service_unavailable");
    }
    const { deliverCouponImage } = await import("./couponDelivery.ts");
    const result = await deliverCouponImage(body, dependencies.couponDelivery);
    return "body" in result && result.body
      ? json(result.status, result.body)
      : error(result.status, result.error ?? "service_unavailable");
  }

  if (action !== "list_services") {
    const {
      getServiceRequirements,
      issueVoiceCoupon,
      saveVoiceIntake,
      submitVoiceRequest,
    } = await import("./workflow.ts");
    const requirements = getServiceRequirements(body.service_id);
    if (!requirements) return error(404, "service_not_found");
    const [serviceResult, campaignResult] = await Promise.all([
      dependencies.listActiveNonCouponServices(
        NON_COUPON_SOURCE_ORGANIZATION_ID,
      ),
      dependencies.listActiveCouponCampaigns(COUPON_SOURCE_ORGANIZATION_ID),
    ]);
    if (serviceResult.error || campaignResult.error) {
      return error(500, "service_lookup_failed");
    }
    const active = requirements.supported_final_action === "issue_coupon"
      ? (campaignResult.data ?? []).some((row) =>
        row.active === true && row.service_id === requirements.service_id
      )
      : (serviceResult.data ?? []).some((row) =>
        row.activo === true && row.id === requirements.service_id
      );
    if (!active) return error(409, "service_inactive");
    if (action === "get_service_requirements") {
      return json(200, requirements);
    }
    if (!dependencies.workflow) return error(500, "service_unavailable");
    const result = action === "save_intake"
      ? await saveVoiceIntake(body, dependencies.workflow)
      : action === "submit_service_request"
      ? await submitVoiceRequest(body, dependencies.workflow)
      : await issueVoiceCoupon(body, dependencies.workflow);
    if ("body" in result && result.body) {
      return json(result.status, result.body);
    }
    return error(result.status, result.error ?? "service_unavailable");
  }

  const [servicesResult, campaignsResult] = await Promise.all([
    dependencies.listActiveNonCouponServices(
      NON_COUPON_SOURCE_ORGANIZATION_ID,
    ),
    dependencies.listActiveCouponCampaigns(COUPON_SOURCE_ORGANIZATION_ID),
  ]);
  if (servicesResult.error || campaignsResult.error) {
    dependencies.log?.({
      event: "referral_voice_tool_failed",
      action,
      organization_id: organizationId,
      error: "service_lookup_failed",
    });
    return error(500, "service_lookup_failed");
  }

  const services = projectServices(
    servicesResult.data ?? [],
    campaignsResult.data ?? [],
  );
  dependencies.log?.({
    event: "referral_voice_tool_succeeded",
    action,
    organization_id: organizationId,
    service_count: services.length,
  });
  return json(200, {
    success: true,
    organization_id: organizationId,
    services,
  });
}
