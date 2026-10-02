import type { InteractiveButton, WhatsAppInteractiveListSpec } from "../../../_shared/metaMessageAdapter.ts";
import { getPantryDemoPackage, PANTRY_DEMO_PACKAGES, type PantryDemoPackage, type PantryPackageKey } from "./pantryDemoCatalog.ts";
import {
  classifyPantryDeliveryCoverage,
  normalizeUsZipCode,
  PANTRY_DELIVERY_COVERAGE,
  type PantryDeliveryCoverageConfig,
  type PantryDeliveryCoverageStatus,
} from "./pantryDeliveryCoverage.ts";
import type { IssuedCoupon } from "./couponService.ts";

type Json = Record<string, unknown>;
export const PANTRY_COUPON_SERVICE_ID = "luis_cupon_super";

export type PantryPreludeMessage = { text?: string; imageUrl?: string };
type RecurringPreference = { interested: boolean; frequency: "weekly" | "biweekly" | "monthly" | null };
type CustomerState = { name: string | null; address: string | null; city: string | null; zip_code: string | null; delivery_notes: string | null };
type CouponState = { id?: string; code: string; status?: string; public_url?: string; issued_at: string; expires_at?: string | null; active: boolean; source?: "database" };

export type PantryDemoState = {
  active?: boolean;
  coupon?: CouponState | null;
  legacy_coupon?: CouponState | null;
  selected_package?: PantryPackageKey | null;
  /** Legacy compatibility only. This value is intentionally ignored. */
  coupon_applied?: boolean;
  customer?: CustomerState;
  delivery_coverage_status?: PantryDeliveryCoverageStatus | null;
  coverage_notification_requested?: boolean;
  payment_method?: "cash_on_delivery" | "card_on_delivery" | "zelle_on_confirmation" | null;
  request_confirmed?: boolean;
  confirmed_at?: string | null;
  recurring_preference?: RecurringPreference | null;
  current_step?: string | null;
  editing_field?: "name" | "address" | "payment_method" | null;
  step?: string | null;
  package_id?: string | null;
};

export type PantryDemoTurnResult = {
  reply: string;
  statePatch: Json;
  leadPatch?: Json;
  debugNote: string;
  interactiveButtons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
  imageUrl?: string;
  outboundPrelude?: PantryPreludeMessage[];
};

const EMPTY_CUSTOMER: CustomerState = { name: null, address: null, city: null, zip_code: null, delivery_notes: null };
const PAYMENT_LABELS: Record<string, string> = {
  cash_on_delivery: "Efectivo al recibir",
  card_on_delivery: "Tarjeta al recibir",
  zelle_on_confirmation: "Zelle al confirmar",
};
const COVERAGE_LABELS: Record<PantryDeliveryCoverageStatus, string> = {
  available: "Disponible",
  manual_review: "Pendiente de confirmación",
  unavailable: "Fuera de cobertura",
};
const PANTRY_UPSELL_TEXT = "🛒 También tenemos compras de supermercado ya preparadas con delivery.";

function safe(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function normalize(value: unknown): string {
  return safe(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^action:/, "").replace(/[^a-z0-9$]+/g, " ").replace(/\s+/g, " ").trim();
}
function selectedAction(inboundText: string, payloadAction?: string | null): string {
  return safe(payloadAction).replace(/^action:/i, "") || safe(inboundText);
}

export function getPantryDemoState(leadState: Json | null | undefined): PantryDemoState {
  const referral = (((leadState?.collected ?? {}) as Json).referral_hub ?? {}) as Json;
  const raw = ((referral.pantry_demo ?? {}) as PantryDemoState);
  const legacyPackage = safe(raw.package_id).replace(/^shop_/, "") as PantryPackageKey;
  return {
    ...raw,
    selected_package: raw.selected_package ?? (getPantryDemoPackage(legacyPackage) ? legacyPackage : null),
    current_step: raw.current_step ?? raw.step ?? null,
    customer: { ...EMPTY_CUSTOMER, ...(raw.customer ?? {}) },
  };
}

function mergePantryState(leadState: Json | null | undefined, patch: PantryDemoState): Json {
  const collected = ((leadState?.collected ?? {}) as Json);
  const referral = ((collected.referral_hub ?? {}) as Json);
  const current = getPantryDemoState(leadState);
  return {
    ...collected,
    referral_hub: {
      ...referral,
      service_id: PANTRY_COUPON_SERVICE_ID,
      pantry_demo: {
        ...current,
        ...patch,
        customer: { ...EMPTY_CUSTOMER, ...(current.customer ?? {}), ...(patch.customer ?? {}) },
      },
    },
  };
}

function result(leadState: Json | null | undefined, reply: string, patch: PantryDemoState, extra: Partial<PantryDemoTurnResult> = {}): PantryDemoTurnResult {
  const nextStep = patch.current_step ?? "completed";
  return {
    reply,
    statePatch: {
      stage: patch.request_confirmed ? "QUALIFIED" : "DISCOVERY",
      orgType: "referral_hub",
      active_flow: patch.active === false ? "referral_hub_completed" : "referral_hub_pantry_demo",
      nextExpected: patch.active === false ? undefined : `pantry_demo:${nextStep}`,
      collected: mergePantryState(leadState, patch),
      lastIntent: `pantry_demo_${nextStep}`,
    },
    leadPatch: { service_id: PANTRY_COUPON_SERVICE_ID, status: patch.request_confirmed ? "qualified" : "contacted" },
    debugNote: `referral_hub:pantry_demo:${nextStep}`,
    ...extra,
  };
}

function newCouponCode(): string {
  return `SUPER20-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function ensureCoupon(state: PantryDemoState): CouponState {
  return state.coupon?.active && safe(state.coupon.code)
    ? state.coupon
    : { code: newCouponCode(), issued_at: new Date().toISOString(), active: true };
}

function packageRows() {
  const titles: Record<PantryPackageKey, string> = {
    essential: "🧺 Compra Esencial",
    family: "👨‍👩‍👧‍👦 Familiar",
    complete: "🏠 Compra Completa",
  };
  return PANTRY_DEMO_PACKAGES.map((item) => ({ id: `pantry:package:${item.id}`, title: titles[item.id], description: `${item.name} — $${item.price} aprox.` }));
}

function packageListSpec(): WhatsAppInteractiveListSpec {
  return {
    body: "Selecciona una compra:",
    buttonText: "Ver opciones",
    sections: [{ title: "Compras preparadas", rows: [
      ...packageRows(),
      { id: "pantry:coupon_only", title: "🎟️ Solo quiero cupón", description: "Conservar mi cupón" },
    ] }],
  };
}

function startCoupon(leadState: Json | null | undefined, issuedCoupon?: IssuedCoupon): PantryDemoTurnResult {
  const prior = getPantryDemoState(leadState).coupon;
  const coupon: CouponState = issuedCoupon ? { id: issuedCoupon.id, code: issuedCoupon.code, status: issuedCoupon.status, public_url: issuedCoupon.publicUrl, issued_at: issuedCoupon.issuedAt, expires_at: issuedCoupon.expiresAt, active: issuedCoupon.status === "active", source: "database" } : ensureCoupon(getPantryDemoState(leadState));
  const couponText = !issuedCoupon ? `🎉 ¡Listo! Ya tienes tu cupón de $20.\n\nTu código es: *${coupon.code}*\n\nGuárdalo y muéstralo al momento de realizar tu compra.`
    : issuedCoupon.status === "redeemed" ? "Este cupón ya fue utilizado y no puede volver a canjearse."
    : issuedCoupon?.status === "expired" ? "Este cupón ya venció."
    : issuedCoupon?.status === "void" ? "Este cupón ya no es válido."
    : `${issuedCoupon?.wasCreated ? "🎉 Tu cupón de $20 está listo." : "Ya tienes un cupón activo."}\n\nÁbrelo cuando vayas a pagar:\n${coupon.public_url}\n\nℹ️ Este cupón aplica únicamente en compras realizadas en tienda. No aplica a pedidos con delivery.`;
  return result(leadState, packageListSpec().body, {
    active: true,
    coupon,
    ...(issuedCoupon && prior && prior.source !== "database" ? { legacy_coupon: prior } : {}),
    current_step: "package_selection",
    request_confirmed: false,
  }, {
    outboundPrelude: [
      { ...(issuedCoupon ? {} : { imageUrl: "/images/coupon-demo.jpg" }), text: couponText },
      { text: PANTRY_UPSELL_TEXT },
    ],
    interactiveList: packageListSpec(),
  });
}

function showPackageList(leadState: Json | null | undefined): PantryDemoTurnResult {
  return result(leadState, packageListSpec().body, { active: true, current_step: "package_selection" }, { interactiveList: packageListSpec() });
}

function couponOnly(leadState: Json | null | undefined): PantryDemoTurnResult {
  return result(leadState, "Perfecto. Ya tienes tu cupón guardado.\n\nCuando quieras ver nuestras compras preparadas, escribe “Ver compras”.", {
    active: false,
    coupon: ensureCoupon(getPantryDemoState(leadState)),
    current_step: "coupon_only",
  });
}

const PACKAGE_SUMMARIES: Record<PantryPackageKey, string> = {
  essential: "🧺 *Compra Esencial — $69 aprox.*\n\nIdeal para 1–2 personas.\n\nIncluye despensa básica, pollo, huevos, leche, tortillas, pan, vegetales y otros productos esenciales.\n\n*14 productos en total.*\n\nEl delivery se confirma según el código postal y la sucursal.",
  family: "👨‍👩‍👧‍👦 *Compra Familiar — $169 aprox.*\n\nIdeal para 3–4 personas.\n\nIncluye despensa, pollo, carne molida, huevos, lácteos, tortillas, frutas, vegetales y otros productos para el hogar.\n\n*20 productos en total.*\n\nEl delivery se confirma según el código postal y la sucursal.",
  complete: "🏠 *Compra Completa — $349 aprox.*\n\nIdeal para hogares de 5 personas o más.\n\nIncluye despensa amplia, carnes, lácteos, frutas, vegetales, papel y productos de limpieza.\n\n*26 productos en total.*\n\nEl delivery se confirma según el código postal y la sucursal.",
};

const PACKAGE_AVAILABILITY_NOTICE = "Los productos, marcas y presentaciones pueden variar según disponibilidad. Cualquier sustitución será por un producto equivalente.";

function packageActionsListSpec(): WhatsAppInteractiveListSpec {
  return {
    body: "Elige qué quieres hacer:",
    buttonText: "Ver opciones",
    sections: [{ title: "Opciones", rows: [
      { id: "pantry:details", title: "📋 Ver todo incluido", description: "Ver todo lo que incluye" },
      { id: "pantry:wanted", title: "✅ La quiero" },
      { id: "pantry:other", title: "🔄 Ver otra compra" },
    ] }],
  };
}

function showPackage(leadState: Json | null | undefined, packageId: PantryPackageKey): PantryDemoTurnResult {
  const item = getPantryDemoPackage(packageId) ?? PANTRY_DEMO_PACKAGES[0];
  return result(leadState, packageActionsListSpec().body, {
    active: true,
    selected_package: item.id,
    customer: EMPTY_CUSTOMER,
    delivery_coverage_status: null,
    coverage_notification_requested: false,
    payment_method: null,
    request_confirmed: false,
    confirmed_at: null,
    current_step: "package",
  }, {
    outboundPrelude: [{ imageUrl: item.imageUrl }, { text: PACKAGE_SUMMARIES[item.id] }],
    interactiveList: packageActionsListSpec(),
  });
}

function showPackageDetails(leadState: Json | null | undefined): PantryDemoTurnResult {
  const state = getPantryDemoState(leadState);
  const item = getPantryDemoPackage(state.selected_package);
  if (!item) return showPackageList(leadState);
  const categories = [
    { title: "🥫 *Despensa y básicos*", key: "pantry" },
    { title: "🥩 *Proteínas y lácteos*", key: "protein" },
    { title: "🍎 *Frutas, vegetales y hogar*", key: "produce_home" },
  ] as const;
  return result(leadState, "¿Qué quieres hacer?", { active: true, current_step: "package_details" }, {
    outboundPrelude: categories.map((category) => ({
      text: `${category.title}\n${item.items.filter((entry) => entry.category === category.key).map((entry) => `• ${entry.name} — ${entry.quantity}`).join("\n")}${category.key === "produce_home" ? `\n\n${PACKAGE_AVAILABILITY_NOTICE}` : ""}`,
    })),
    interactiveButtons: [
      { id: "pantry:wanted", title: "✅ La quiero" },
      { id: "pantry:other", title: "🔄 Ver otra compra" },
    ],
  });
}

function askZip(leadState: Json | null | undefined): PantryDemoTurnResult {
  if (!getPantryDemoPackage(getPantryDemoState(leadState).selected_package)) return showPackageList(leadState);
  return result(leadState, "Perfecto. Primero revisemos si tenemos delivery en tu zona.\n\n¿Cuál es tu código postal?", { active: true, current_step: "zip_code" });
}

function acceptZip(leadState: Json | null | undefined, zipCode: string, coverage: PantryDeliveryCoverageStatus): PantryDemoTurnResult {
  const coverageCopy = coverage === "available"
    ? "Sí, tenemos delivery disponible en tu zona."
    : "Tu zona está pendiente de confirmación.\n\nUn representante verificará la disponibilidad y el horario de delivery antes de preparar la compra.";
  return result(leadState, `${coverageCopy}\n\nPerfecto. ¿A nombre de quién preparamos la compra?`, {
    active: true,
    customer: { ...EMPTY_CUSTOMER, ...getPantryDemoState(leadState).customer, zip_code: zipCode },
    delivery_coverage_status: coverage,
    coverage_notification_requested: false,
    current_step: "name",
  });
}

function unavailableZip(leadState: Json | null | undefined, zipCode: string): PantryDemoTurnResult {
  return result(leadState, "Todavía no tenemos delivery disponible en ese código postal.\n\n¿Quieres que te avisemos cuando abramos cobertura en tu zona?", {
    active: true,
    customer: { ...EMPTY_CUSTOMER, zip_code: zipCode },
    delivery_coverage_status: "unavailable",
    coverage_notification_requested: false,
    current_step: "coverage_unavailable",
  }, {
    interactiveButtons: [
      { id: "pantry:coverage_notify", title: "Sí, avísenme" },
      { id: "pantry:other", title: "Ver otra compra" },
      { id: "pantry:coupon_only", title: "Solo quiero mi cupón" },
    ],
  });
}

function askAddress(leadState: Json | null | undefined, name: string): PantryDemoTurnResult {
  return result(leadState, "¿Cuál es la dirección completa para el delivery?\n\nIncluye calle, número, apartamento si aplica, ciudad y código postal.", { active: true, customer: { ...EMPTY_CUSTOMER, ...getPantryDemoState(leadState).customer, name }, current_step: "address" });
}

function askInstructions(leadState: Json | null | undefined, address: string): PantryDemoTurnResult {
  return result(leadState, "¿Hay alguna instrucción para la entrega?\n\nPor ejemplo: apartamento, piso, timbre, puerta trasera o llamar al llegar.", { active: true, customer: { ...EMPTY_CUSTOMER, ...getPantryDemoState(leadState).customer, address }, current_step: "delivery_notes_choice" }, {
    interactiveButtons: [{ id: "pantry:add_notes", title: "Agregar instrucción" }, { id: "pantry:no_notes", title: "No, ninguna" }],
  });
}

function askPayment(leadState: Json | null | undefined, notes?: string | null): PantryDemoTurnResult {
  return result(leadState, "¿Cómo prefieres pagar?\n\nSolo guardaremos tu preferencia. No compartas números de tarjeta ni información bancaria.", { active: true, ...(notes !== undefined ? { customer: { ...EMPTY_CUSTOMER, ...getPantryDemoState(leadState).customer, delivery_notes: notes } } : {}), current_step: "payment" }, {
    interactiveButtons: [
      { id: "pantry:pay:cash", title: "Efectivo al recibir" },
      { id: "pantry:pay:card", title: "Tarjeta al recibir" },
      { id: "pantry:pay:zelle", title: "Zelle al confirmar" },
    ],
  });
}

function summary(leadState: Json | null | undefined, payment?: PantryDemoState["payment_method"]): PantryDemoTurnResult {
  const state = getPantryDemoState(leadState);
  const item = getPantryDemoPackage(state.selected_package);
  const customer = state.customer ?? EMPTY_CUSTOMER;
  const resolvedPayment = payment ?? state.payment_method ?? null;
  if (!item || !customer.name || !customer.address || !customer.zip_code || !state.delivery_coverage_status || !resolvedPayment) return showPackageList(leadState);
  const copy = `*Revisa tu solicitud:*\n\nNombre: ${customer.name}\nCompra: ${item.name}\nPrecio aproximado: $${item.price}\nCódigo postal: ${customer.zip_code}\nCobertura: ${COVERAGE_LABELS[state.delivery_coverage_status]}\nDirección: ${customer.address}\nForma de pago: ${PAYMENT_LABELS[resolvedPayment]}\nInstrucciones: ${customer.delivery_notes || "Ninguna"}\n\n¿Está todo correcto?`;
  return result(leadState, copy, { active: true, payment_method: resolvedPayment, current_step: "summary", editing_field: null }, {
    interactiveButtons: [{ id: "pantry:confirm", title: "Confirmar solicitud" }, { id: "pantry:edit", title: "Cambiar información" }, { id: "pantry:cancel", title: "Cancelar" }],
  });
}

function confirmation(leadState: Json | null | undefined): PantryDemoTurnResult {
  const coupon = ensureCoupon(getPantryDemoState(leadState));
  return result(leadState, `✅ *Solicitud recibida.*\n\nTu compra quedó registrada para esta demostración.\n\nUn representante confirmará contigo la disponibilidad, el horario de delivery y el pago antes de preparar la compra.\n\nTu cupón independiente sigue guardado con el código: ${coupon.code}\n\n¿Quieres recibir una compra similar automáticamente en el futuro?`, { active: true, coupon, request_confirmed: true, confirmed_at: new Date().toISOString(), current_step: "recurring_interest" }, {
    interactiveButtons: [{ id: "pantry:recurring:yes", title: "Sí, me interesa" }, { id: "pantry:recurring:no", title: "No por ahora" }],
  });
}

function howItWorks(leadState: Json | null | undefined): PantryDemoTurnResult {
  return result(leadState, "Eliges una compra y revisamos si tenemos cobertura en tu código postal.\n\nDespués, un representante confirma disponibilidad, horario y pago antes de preparar el delivery.", { active: true, current_step: "how" }, {
    interactiveButtons: [{ id: "pantry:view", title: "Ver las compras" }, { id: "pantry:human", title: "Hablar con alguien" }],
  });
}

function cancel(leadState: Json | null | undefined): PantryDemoTurnResult {
  const state = getPantryDemoState(leadState);
  return result(leadState, "Cancelamos este proceso de demostración. No se creó ninguna orden, pago ni delivery. Tu cupón se conserva.", {
    active: false,
    coupon: ensureCoupon(state),
    selected_package: null,
    customer: EMPTY_CUSTOMER,
    delivery_coverage_status: null,
    coverage_notification_requested: false,
    payment_method: null,
    request_confirmed: false,
    confirmed_at: null,
    recurring_preference: null,
    current_step: "cancelled",
    editing_field: null,
  }, { interactiveButtons: [{ id: "pantry:restart", title: "Empezar de nuevo" }] });
}

function validFreeText(value: string): boolean {
  const normalized = normalize(value);
  return normalized.length >= 2 && !normalized.startsWith("pantry ") && !["la quiero", "ver otra compra", "confirmar solicitud", "cancelar"].includes(normalized);
}

function packageFromInput(value: string): PantryPackageKey | null {
  const normalized = normalize(value);
  if (normalized.includes("esencial")) return "essential";
  if (normalized.includes("familiar")) return "family";
  if (normalized.includes("completa")) return "complete";
  const actionMatch = safe(value).replace(/^action:/i, "").match(/^pantry:package:(essential|family|complete)$/);
  return (actionMatch?.[1] as PantryPackageKey | undefined) ?? null;
}

export function shouldHandlePantryDemo(args: { leadState: Json | null; inboundText: string; payloadAction?: string | null }): boolean {
  const current = getPantryDemoState(args.leadState);
  const rawAction = safe(args.payloadAction || args.inboundText).replace(/^action:/i, "");
  const input = normalize(args.inboundText);
  const exact = new Set(["hola quiero recibir mi cupon", "quiero mi cupon", "cupon supermercado", "obtener mi cupon", "ver compras", "ver las compras"]);
  return Boolean(current.active || rawAction === `referral_service:${PANTRY_COUPON_SERVICE_ID}` || rawAction.startsWith("pantry:") || exact.has(input) || (input.includes("cupon") && (input.includes("super") || input.includes("$20"))));
}

export function isPantryCouponEntry(args: { inboundText: string; payloadAction?: string | null }): boolean {
  const rawAction = safe(args.payloadAction || args.inboundText).replace(/^action:/i, "");
  const input = normalize(args.inboundText);
  return rawAction === `referral_service:${PANTRY_COUPON_SERVICE_ID}` ||
    ["hola quiero recibir mi cupon", "quiero mi cupon", "cupon supermercado", "obtener mi cupon"].includes(input) ||
    (input.includes("cupon") && (input.includes("super") || input.includes("$20")));
}

export function handlePantryDemoTurn(args: {
  leadState: Json | null;
  inboundText: string;
  payloadAction?: string | null;
  coverageConfig?: PantryDeliveryCoverageConfig;
  issuedCoupon?: IssuedCoupon;
}): PantryDemoTurnResult {
  const state = getPantryDemoState(args.leadState);
  const raw = selectedAction(args.inboundText, args.payloadAction);
  const text = normalize(args.inboundText);
  let action = safe(raw).replace(/^action:/i, "");
  if (!action.startsWith("pantry:")) {
    const manualActions: Record<string, string> = {
      "la quiero": "pantry:wanted", "ver otra compra": "pantry:other", "ver todo lo que incluye": "pantry:details", "ver todo incluido": "pantry:details", "solo quiero mi cupon": "pantry:coupon_only",
      "como funciona": "pantry:how", "como funciona el delivery": "pantry:delivery_info",
      "agregar instruccion": "pantry:add_notes", "no ninguna": "pantry:no_notes",
      "efectivo al recibir": "pantry:pay:cash", "tarjeta al recibir": "pantry:pay:card", "zelle al confirmar": "pantry:pay:zelle",
      "confirmar solicitud": "pantry:confirm", "cambiar informacion": "pantry:edit", "cancelar": "pantry:cancel",
      "empezar de nuevo": "pantry:restart", "ver compras": "pantry:view", "ver las compras": "pantry:view",
      "hablar con alguien": "pantry:human", "nombre": "pantry:edit:name", "direccion": "pantry:edit:address",
      "forma de pago": "pantry:edit:payment", "si avisenme": "pantry:coverage_notify",
      "si me interesa": "pantry:recurring:yes", "no por ahora": "pantry:recurring:no",
      "cada semana": "pantry:frequency:weekly", "cada 2 semanas": "pantry:frequency:biweekly",
      "cada dos semanas": "pantry:frequency:biweekly", "cada mes": "pantry:frequency:monthly",
    };
    action = manualActions[text] ?? action;
  }

  const entry = !state.active || isPantryCouponEntry(args);
  if (entry && !action.startsWith("pantry:")) return startCoupon(args.leadState, args.issuedCoupon);

  const packageId = packageFromInput(action) ?? packageFromInput(args.inboundText);
  if (packageId) return showPackage(args.leadState, packageId);
  if (action === "pantry:view") return showPackageList(args.leadState);
  if (action === "pantry:coupon_only") return couponOnly(args.leadState);
  if (action === "pantry:how" || action === "pantry:delivery_info" || text.includes("como funciona")) return howItWorks(args.leadState);
  if (action === "pantry:other") return showPackageList(args.leadState);
  if (action === "pantry:details") return showPackageDetails(args.leadState);
  if (action === "pantry:wanted") return askZip(args.leadState);
  if (action === "pantry:coverage_notify") return result(args.leadState, "Listo. Guardamos tu preferencia para avisarte cuando abramos cobertura en tu zona. No se creó ninguna orden ni delivery.", { active: false, coverage_notification_requested: true, current_step: "coverage_notification_saved" });
  if (action === "pantry:add_notes") return result(args.leadState, "Escribe la instrucción que quieres que tengamos en cuenta.", { active: true, current_step: "delivery_notes" });
  if (action === "pantry:no_notes") return askPayment(args.leadState, null);
  if (action === "pantry:pay:cash") return summary(args.leadState, "cash_on_delivery");
  if (action === "pantry:pay:card") return summary(args.leadState, "card_on_delivery");
  if (action === "pantry:pay:zelle") return summary(args.leadState, "zelle_on_confirmation");
  if (action === "pantry:confirm") return confirmation(args.leadState);
  if (action === "pantry:cancel") return cancel(args.leadState);
  if (action === "pantry:restart") return showPackageList(args.leadState);
  if (action === "pantry:edit") return result(args.leadState, "¿Qué información quieres cambiar?", { active: true, current_step: "edit_selection" }, {
    interactiveList: { body: "Selecciona la información que quieres cambiar:", buttonText: "Cambiar", sections: [{ title: "Información", rows: [
      { id: "pantry:edit:name", title: "Nombre" }, { id: "pantry:edit:address", title: "Dirección" }, { id: "pantry:edit:payment", title: "Forma de pago" },
    ] }] },
  });
  if (action === "pantry:edit:name") return result(args.leadState, "¿A nombre de quién preparamos la compra?", { active: true, current_step: "edit_name", editing_field: "name" });
  if (action === "pantry:edit:address") return result(args.leadState, "Escribe la dirección completa corregida.", { active: true, current_step: "edit_address", editing_field: "address" });
  if (action === "pantry:edit:payment") return askPayment(args.leadState);
  if (action === "pantry:recurring:yes") return result(args.leadState, "¿Cada cuánto te interesaría recibir una compra similar?", { active: true, current_step: "recurring_frequency", recurring_preference: { interested: true, frequency: null } }, {
    interactiveButtons: [{ id: "pantry:frequency:weekly", title: "Cada semana" }, { id: "pantry:frequency:biweekly", title: "Cada 2 semanas" }, { id: "pantry:frequency:monthly", title: "Cada mes" }],
  });
  if (action === "pantry:recurring:no") return result(args.leadState, "Entendido. No activamos ninguna compra automática. Puedes escribirnos cuando quieras.", { active: false, current_step: "completed", recurring_preference: { interested: false, frequency: null } });
  if (action.startsWith("pantry:frequency:")) {
    const frequency = action.replace("pantry:frequency:", "") as "weekly" | "biweekly" | "monthly";
    return result(args.leadState, "Guardamos tu preferencia para esta demostración. No activa órdenes, cobros ni entregas automáticas.", { active: false, current_step: "completed", recurring_preference: { interested: true, frequency } });
  }
  if (action === "pantry:human") return result(args.leadState, "Un representante continuará contigo por este WhatsApp. No se creó ninguna orden ni pago.", { active: false, current_step: "human_handoff" }, { leadPatch: { service_id: PANTRY_COUPON_SERVICE_ID, status: "contacted", handoff_to_human: true } });

  if (state.current_step === "zip_code") {
    const zipCode = normalizeUsZipCode(args.inboundText);
    if (!zipCode) return result(args.leadState, "Ese código postal no parece válido. Escribe un ZIP de 5 dígitos, por ejemplo 07102, o ZIP+4, por ejemplo 07102-1234.", { active: true, current_step: "zip_code" });
    const coverage = classifyPantryDeliveryCoverage(zipCode, args.coverageConfig ?? PANTRY_DELIVERY_COVERAGE);
    return coverage === "unavailable" ? unavailableZip(args.leadState, zipCode) : acceptZip(args.leadState, zipCode, coverage);
  }
  if (state.current_step === "name" && validFreeText(args.inboundText)) return askAddress(args.leadState, safe(args.inboundText));
  if (state.current_step === "address" && validFreeText(args.inboundText)) return askInstructions(args.leadState, safe(args.inboundText));
  if (state.current_step === "delivery_notes" && validFreeText(args.inboundText)) return askPayment(args.leadState, safe(args.inboundText));
  if (state.current_step === "edit_name" && validFreeText(args.inboundText)) return summaryFromEdit(args.leadState, { name: safe(args.inboundText) });
  if (state.current_step === "edit_address" && validFreeText(args.inboundText)) return summaryFromEdit(args.leadState, { address: safe(args.inboundText) });

  if (state.current_step === "package_selection") return showPackageList(args.leadState);
  if (state.current_step === "package" && state.selected_package) return showPackage(args.leadState, state.selected_package);
  if (state.current_step === "package_details") return showPackageDetails(args.leadState);
  if (state.current_step === "zip_code") return askZip(args.leadState);
  if (state.current_step === "name") return result(args.leadState, "Necesito un nombre válido para continuar.", { active: true, current_step: "name" });
  if (state.current_step === "address") return result(args.leadState, "Necesito una dirección completa para continuar.", { active: true, current_step: "address" });
  if (state.current_step === "delivery_notes_choice") return askInstructions(args.leadState, state.customer?.address ?? "");
  if (state.current_step === "payment") return askPayment(args.leadState);
  if (state.current_step === "summary") return summary(args.leadState);
  if (state.current_step === "coverage_unavailable") return unavailableZip(args.leadState, state.customer?.zip_code ?? "");
  if (state.current_step === "recurring_interest") return confirmation(args.leadState);
  return startCoupon(args.leadState);
}

function summaryFromEdit(leadState: Json | null | undefined, customerPatch: Partial<CustomerState>): PantryDemoTurnResult {
  const current = getPantryDemoState(leadState);
  const syntheticState = {
    ...(leadState ?? {}),
    collected: mergePantryState(leadState, { customer: { ...EMPTY_CUSTOMER, ...(current.customer ?? {}), ...customerPatch }, editing_field: null }),
  };
  return summary(syntheticState as Json);
}
