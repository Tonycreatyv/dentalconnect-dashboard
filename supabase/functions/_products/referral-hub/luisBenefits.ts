export const LUIS_BENEFITS_FLOW_ACTION = "luis_benefits:complete";
export const LUIS_BENEFITS_FLOW_SCREEN = "BENEFIT_SELECT";
export const LUIS_BENEFITS_MARKETING_COPY_VERSION = "luis_benefits_flow_v1";

export type LuisBenefitKey = "SUPERMARKET" | "MEDICAL" | "DENTAL" | "SHIPPING" | "MABLETON_PARRILLADA";

export type LuisBenefitFlowCompletion = {
  benefit_key: LuisBenefitKey;
  full_name: string;
  postal_code: string;
  email: string | null;
  marketing_consent: boolean;
};

export type LuisBenefitDefinition = {
  key: LuisBenefitKey;
  campaignKey: string;
  displayName: string;
  partnerName?: string;
  mediaUrl?: string;
};

export type LuisLegalTopic = "IMMIGRATION" | "AUTO_ACCIDENT" | "CRIMINAL";

export type LuisLegalState = {
  topic?: LuisLegalTopic;
  step?: "description" | "date" | "medical_attention" | "medical_location" | "completed";
};

// Micro-intake V1 (frozen data contract): FAMILY_GREEN_CARD/GREEN_CARD_RENEWAL/
// ASYLUM/U_VISA are new canonical topics; CONSULTATION/GREEN_CARD/
// FAMILY_PETITION/IMMIGRATION_COURT remain accepted forever for old stored
// completions — never removed, never renamed (see parseLuisLegalFlowCompletion).
export type LuisImmigrationTopic =
  | "CONSULTATION"
  | "GREEN_CARD"
  | "CITIZENSHIP"
  | "WORK_PERMIT"
  | "FAMILY_PETITION"
  | "IMMIGRATION_COURT"
  | "OTHER"
  | "FAMILY_GREEN_CARD"
  | "GREEN_CARD_RENEWAL"
  | "ASYLUM"
  | "U_VISA";

export type LuisLegalFlowCompletion =
  | {
    intake_type: "IMMIGRATION";
    topic: LuisImmigrationTopic;
    full_name: string;
    postal_code: string | null;
    description: string;
    sharing_consent: "AUTHORIZED" | "DECLINED" | "PENDING";
    consent_version: string | null;
    consent_source: string | null;
    // Every field below is optional/additive: present only for its matching
    // topic, absent for every other topic, and always absent on any
    // completion from before this V1 micro-intake existed.
    resident_duration?: "LESS_THAN_3_YEARS" | "THREE_TO_FIVE_YEARS" | "MORE_THAN_5_YEARS" | null;
    long_absence?: "YES" | "NO" | "NOT_SURE" | null;
    citizenship_marriage_basis?: "YES" | "NO" | "NOT_SURE" | null;
    petitioner_relationship?: "US_CITIZEN_SPOUSE" | "RESIDENT_SPOUSE" | "PARENT" | "ADULT_CHILD" | "OTHER" | "NOT_SURE" | null;
    entry_method?: "VISA" | "PAROLE" | "WITHOUT_INSPECTION" | "NOT_SURE" | null;
    prior_uscis_petition?: "YES" | "NO" | "NOT_SURE" | null;
    green_card_term?: "TWO_YEAR" | "TEN_YEAR" | "NOT_SURE" | null;
    green_card_issue?: "EXPIRING" | "EXPIRED" | "LOST_OR_STOLEN" | "DAMAGED" | "OTHER" | null;
    prior_related_filing?: "YES" | "NO" | "NOT_SURE" | null;
    arrival_window?: "LESS_THAN_ONE_YEAR" | "MORE_THAN_ONE_YEAR" | "NOT_SURE" | null;
    fear_reason?: "POLITICAL" | "RELIGION" | "NATIONALITY" | "RACE" | "SOCIAL_GROUP" | "OTHER" | "NOT_SURE" | null;
    immigration_court_status?: "YES" | "NO" | "NOT_SURE" | null;
    crime_victim?: "YES" | "NO" | "NOT_SURE" | null;
    police_report?: "YES" | "NO" | "NOT_SURE" | null;
    law_enforcement_cooperation?: "YES" | "NO" | "NOT_SURE" | null;
    work_permit_request_type?: "FIRST_APPLICATION" | "RENEWAL" | "REPLACEMENT" | null;
    work_permit_basis?: "ASYLUM" | "ADJUSTMENT" | "TPS" | "OTHER" | "NOT_SURE" | null;
    work_permit_status?: "VALID" | "EXPIRING" | "EXPIRED" | "NONE" | "NOT_SURE" | null;
  }
  | {
    intake_type: "AUTO_ACCIDENT";
    full_name: string;
    postal_code: string | null;
    accident_date: string;
    received_medical_attention: "YES" | "NO";
    // participant_role/medical_provider are legacy-only: the V1 micro-intake
    // Flow no longer asks either, but old stored completions that have them
    // must keep parsing (see parseLuisLegalFlowCompletion).
    participant_role: "DRIVER" | "PASSENGER" | "OTHER" | null;
    medical_provider: string | null;
    police_report: "YES" | "NO" | "NOT_SURE" | null;
    description: string;
    // Defaults to "PENDING" when absent, exactly like IMMIGRATION's own
    // fallback — every pre-V1 stored completion lacked this field entirely
    // (this branch never had a consent step before V1). See capture gating
    // in buildLuisLegalFlowCompletionResult.
    sharing_consent: "AUTHORIZED" | "DECLINED" | "PENDING";
    consent_version: string | null;
    consent_source: string | null;
  }
  // Legacy-only: no longer produced by the V1 Flow (DUI/CRIMINAL are now
  // their own distinct intake_type below), kept solely so old stored
  // completions of this shape keep parsing without error.
  | {
    intake_type: "DUI_CRIMINAL";
    topic: "DUI" | "ARREST" | "CRIMINAL_CHARGE" | "COURT_SUMMONS" | "OTHER";
    full_name: string;
    postal_code: string | null;
    description: string;
  }
  | {
    intake_type: "DUI";
    full_name: string;
    postal_code: string | null;
    dui_date: string;
    chemical_test: "COMPLETED" | "REFUSED" | "NOT_SURE";
    court_date_status: "YES" | "NO" | "NOT_SURE";
    description: string;
    sharing_consent: "AUTHORIZED" | "DECLINED" | "PENDING";
    consent_version: string | null;
    consent_source: string | null;
  }
  | {
    intake_type: "CRIMINAL";
    full_name: string;
    postal_code: string | null;
    criminal_charge: string;
    court_date_status: "YES" | "NO" | "NOT_SURE";
    currently_detained: "YES" | "NO";
    description: string;
    sharing_consent: "AUTHORIZED" | "DECLINED" | "PENDING";
    consent_version: string | null;
    consent_source: string | null;
  };

export type LuisConversationRoute =
  // trigger distinguishes a bare greeting ("Hola") from an explicit menu
  // request ("Menú principal"/"Volver al menú"/action) or the ambiguous
  // catch-all fallback for otherwise-unclassified free text - a returning
  // customer who just says "Hola" gets a warmer, personalized greeting
  // (see luisReturningGreeting in run-replies/index.ts) instead of the
  // "Claro 👌 ..." reentry copy that reads oddly outside an explicit
  // menu-return.
  | { kind: "main_menu"; trigger: "greeting" | "explicit" }
  // "Ver beneficios" on the post-benefit-delivery menu (button id
  // luis_benefits:another). Deliberately its own kind, checked ahead of
  // the pre-existing "luis benefits another" match a few lines down (which
  // routes to the generic {kind:"benefits"} path and, through
  // luisBenefitsFlowEntryResult's un-configured-legacy-Flow fallback,
  // could reach LUIS_UNIFIED_FLOW_BENEFITS_ENTRY_SCREEN — a screen name
  // that is documented elsewhere in this file as draft-only and NOT live
  // on the published Flow). This kind's own handler in run-replies/index.ts
  // opens SERVICE_SELECT via luisUnifiedFlowEntryResult (same mechanism as
  // post_benefit_services) — NOT BENEFIT_SELECT: Meta's Graph API rejects a
  // Flow-trigger targeting BENEFIT_SELECT directly (error 131009 — it only
  // has an inbound edge from SERVICE_SELECT in this Flow's routing_model,
  // so it isn't a valid external entry screen), confirmed via a live send.
  | { kind: "post_benefit_reopen_benefits" }
  | { kind: "post_benefit_menu" }
  | { kind: "post_benefit_services" }
  | { kind: "post_benefit_finalize" }
  | { kind: "nearest_supermarket_confirm" }
  | { kind: "nearest_supermarket_reject" }
  // requestedBenefitKey is a COPY hint only (which benefit-specific
  // greeting/CTA text to show), never a Flow screen selector — the
  // standalone and Unified Flows both only ever have BENEFIT_SELECT
  // reachable via one shared, non-entry screen (verified against Meta's
  // own routing-model rules: an entry screen must have zero inbound
  // edges; BENEFIT_SELECT/BENEFIT_DETAILS both have one in every
  // published version of these Flows), so it can never be used to skip
  // the customer's own benefit selection inside the Flow itself.
  | { kind: "benefits"; directCampaignEntry?: boolean; requestedBenefitKey?: LuisBenefitKey }
  // A generic coupon/benefit mention with no specific benefit named
  // ("Hola quiero un cupón", "Necesito un beneficio") - asks which benefit
  // before opening the standalone Benefits Flow, mirroring legal_menu's
  // clarify-before-guessing pattern. An explicit benefit request
  // ("cupón de supermercado") still opens the Flow directly via
  // {kind:"benefits"}, never this.
  | { kind: "benefits_clarify" }
  | { kind: "human_handoff" }
  | { kind: "legal_menu" }
  | { kind: "legal_prompt"; topic: LuisLegalTopic; step: LuisLegalState["step"] }
  | { kind: "legal_complete"; topic: LuisLegalTopic }
  | { kind: "legal_emergency" }
  | { kind: "unrecognized" };

export type LuisTestFlowIntent =
  | "BENEFITS"
  | "IMMIGRATION"
  | "AUTO_ACCIDENT"
  | "DUI_CRIMINAL";

// Closed classification result for the natural-language intent interpreter.
// Interpretation only: no field here ever writes data, creates a claim,
// triggers a handoff, or sends a message - routeLuisConversation maps this
// to a LuisConversationRoute, and the existing deterministic handlers in
// run-replies/index.ts remain the only place any action actually happens.
export type LuisIntent =
  | { kind: "MENU" }
  | { kind: "GENERAL_ENTRY" }
  | { kind: "BENEFITS"; benefitKey?: LuisBenefitKey }
  | { kind: "IMMIGRATION" }
  | { kind: "AUTO_ACCIDENT" }
  | { kind: "DUI_CRIMINAL" }
  // A generic legal-help mention (e.g. "ayuda legal", "hablar con un
  // abogado") with no specific topic signal, OR a specific topic signal
  // that was downgraded because the sender described a THIRD PARTY's
  // situation rather than their own (see LUIS_THIRD_PARTY_REFERENT_PATTERN)
  // - routeLuisConversation maps this to the existing 3-option legal_menu
  // clarification rather than guessing a topic.
  | { kind: "LEGAL_AMBIGUOUS" }
  | { kind: "HANDOFF" };

/**
 * The nfm_reply contract is the only trustworthy discriminator available to
 * the worker. Meta does not include a Flow ID in the normalized webhook event.
 * Classify before validating so a legal intake can never be treated as a
 * benefit claim just because both arrive as `nfm_reply` messages.
 */
export type LuisFlowCompletionKind = "BENEFITS" | "FURNITURE" | "LEGAL" | "HANDOFF" | "MERCADITO" | "UNKNOWN";

export type LuisFurnitureFlowCompletion = {\n  service_key: "FURNITURE";\n  full_name: string;\n  postal_code: string;\n};\n\nexport const LUIS_BENEFITS: Record<LuisBenefitKey, LuisBenefitDefinition> = {
  SUPERMARKET: {
    key: "SUPERMARKET",
    campaignKey: "luis_benefit_supermarket_20",
    displayName: "$20 para tu compra de supermercado",
  },
  // Location-aware like SUPERMARKET (own referral_benefit_campaign_locations
  // row, single ZIP 30126) — deliberately has no partnerName/mediaUrl here,
  // since both are resolved exclusively from that location row via the RPC,
  // never from this static definition. A fixed-price offer, not a discount:
  // see referral_coupon_campaigns.offer_terms for luis_benefit_mableton_parrillada.
  MABLETON_PARRILLADA: {
    key: "MABLETON_PARRILLADA",
    campaignKey: "luis_benefit_mableton_parrillada",
    displayName: "La Super Parrillada",
  },
  MEDICAL: {
    key: "MEDICAL",
    campaignKey: "luis_benefit_medical_20",
    displayName: "20% de descuento en servicios médicos",
    partnerName: "Médico Urgencias",
    mediaUrl: "https://referral.creatyv.io/images/coupons/luis/medico-urgencias.jpeg",
  },
  DENTAL: {
    key: "DENTAL",
    campaignKey: "luis_benefit_dental_29",
    displayName: "Consulta + limpieza + rayos X por $29",
    partnerName: "Dental Now 14",
    mediaUrl: "https://referral.creatyv.io/images/coupons/luis/dental-now-14.jpeg",
  },
  SHIPPING: {
    key: "SHIPPING",
    campaignKey: "luis_benefit_shipping_20",
    displayName: "$20 de descuento en tu próximo envío",
    partnerName: "Ultra Cargo",
    mediaUrl: "https://referral.creatyv.io/images/coupons/luis/ultra-cargo.jpeg",
  },
};

// The Mableton Supermarket's fixed-price offer overrides the default $20
// SUPERMARKET benefit for exactly the postal_code its own
// referral_benefit_campaign_locations row is configured for — resolved by
// the caller querying that table generically (never a hardcoded ZIP
// literal here), so this stays pure and unit-testable. SUPERMARKET is the
// only benefit_key the Flow ever submits for any supermarket-family
// request (there is no separate "Mableton" menu option, by design), so the
// caller must resolve this before choosing which campaign_key to claim
// against and which displayName/activation text to show.
export function resolveSupermarketBenefit(mabletonLocationMatched: boolean): LuisBenefitDefinition {
  return mabletonLocationMatched ? LUIS_BENEFITS.MABLETON_PARRILLADA : LUIS_BENEFITS.SUPERMARKET;
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 &&
      value.trim().length <= max
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

// Problem 1 (2026-08-25, real production failure - lead 0bb34495, ZIP
// 30096): a Flow TextInput with input-type:"number" is quoted in this
// product's own payload templates ("postal_code": "${form.postal_code}"),
// so it normally arrives as a string - but a real customer's supermarket
// submission was rejected outright by parseLuisBenefitFlowCompletion with
// no claim ever created, and no other validation rule plausibly explains
// it (her name/ZIP were valid, and her very next submission for a
// different benefit succeeded). The one previously-known, previously-
// unconfirmed risk for exactly this field type is some WhatsApp client
// occasionally sending an unquoted JSON number instead - text(value, max)
// silently returns "" for a number, indistinguishable from a genuinely
// missing field, and a customer whose actual ZIP was perfectly valid gets
// "No pudimos validar tu beneficio" with no way to recover. A 5-digit
// value that arrives as a JS number is unambiguous (no information is
// lost - GA/US ZIPs never fail to round-trip through padStart), so this
// accepts it instead of rejecting a real, valid submission.
function postalCodeText(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 99999) {
    return String(value).padStart(5, "0");
  }
  return text(value, 16);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedLuisText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isLuisMainMenuCommand(value: unknown) {
  const normalized = normalizedLuisText(value);
  return normalized === "menu";
}

// Natural-language menu request, broader than isLuisMainMenuCommand's exact
// "menu" match: covers real phrasings like "Menú principal", "Volver al
// menú", "Ver opciones", "Otras opciones" - a substring/word match, not an
// exact-phrase requirement, so an explicit menu request always wins even
// when phrased as part of a longer sentence or while a legal intake step is
// mid-flow (Part 11: menu must never be forced into exact-keyword-only
// matching).
const LUIS_MENU_REQUEST_PATTERN =
  /\bmenu\b|\bver opciones\b|\botras opciones\b|\bopciones disponibles\b/;

export function isLuisMenuRequestText(value: unknown) {
  return LUIS_MENU_REQUEST_PATTERN.test(normalizedLuisText(value));
}

const LUIS_GREETING_WORDS = new Set([
  "hola",
  "buenas",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "hello",
  "hi",
]);

// Exact-match only (mirrors isLuisMainMenuCommand): a bare greeting is an
// explicit menu request and must reopen the main menu even over a stale
// pending legal intake. A longer message that merely starts with "hola"
// (e.g. "Hola, tuve un accidente...") does NOT match, so it still completes
// the in-progress intake exactly as before - only a standalone greeting
// overrides state.
export function isLuisGreetingCommand(value: unknown) {
  return LUIS_GREETING_WORDS.has(normalizedLuisText(value));
}

/** TEST transport only: Flow-first mapping for menu payloads and short test phrases. */
export function routeLuisTestFlowIntent(args: {
  inboundText: unknown;
  payloadAction?: unknown;
}): LuisTestFlowIntent | null {
  const inbound = normalizedLuisText(args.inboundText);
  const action = normalizedLuisText(args.payloadAction);
  if (
    action === "luis main benefits" || action === "luis benefits another" ||
    inbound === "hola quiero activar mis beneficios" || inbound === "beneficios y cupones"
    || inbound === "quiero mis beneficios" || inbound === "beneficios" ||
    inbound === "cupones" || inbound === "quiero los cupones"
  ) return "BENEFITS";
  if (action === "luis legal immigration" || inbound === "migracion" || inbound === "inmigracion") return "IMMIGRATION";
  if (action === "luis legal accident" || action === "luis legal auto accident" || inbound === "accidente" || inbound === "accidente de auto") return "AUTO_ACCIDENT";
  if (action === "luis legal criminal" || action === "luis legal dui criminal" || inbound === "dui" || inbound === "dui defensa criminal") return "DUI_CRIMINAL";
  return null;
}

function isLuisEmergencyText(value: unknown) {
  return /\b(emergencia|peligro inmediato|peligro|sangrando|sangrado|inconsciente|no puedo respirar|no puede respirar|ataque|arma|amenaza)\b/
    .test(normalizedLuisText(value));
}

// --- Natural-language intent interpretation --------------------------------
// Cheap, deterministic pattern families (not an exact-phrase keyword list -
// each entry is a small regex covering many real phrasings of the same
// underlying intent). Classification only: interpretLuisIntent never writes
// state or performs an action. No approved LLM classifier exists on this
// product path today (the codebase's LLM classifier is scoped to dental
// orgs and never runs for Luis), so this stays fully deterministic; the
// function signature is intentionally the only thing routeLuisConversation
// depends on, so a future constrained LLM fallback could be layered inside
// it later without touching any call site.

// A strong, explicit request to talk to a person - not triggered by a
// generic "necesito ayuda", per the required behavior.
const LUIS_HANDOFF_PATTERN =
  /\b(hablar|comunicarme|conectarme)\b(?:\s+\w+){0,4}\s+\b(alguien|persona|agente|representante|equipo|humano)\b/;
const LUIS_HANDOFF_PERSON_PATTERN =
  /\bnecesito\b(?:\s+\w+){0,3}\s+\b(una persona|un humano|un agente)\b/;

// Each pattern includes a small, bounded set of common misspellings/regional
// variants (missing accents are already stripped by normalizedLuisText, so
// only real spelling-mistake variants need listing here) - not an
// unmaintainable exhaustive list, just the handful seen in real traffic.
const LUIS_IMMIGRATION_PATTERN =
  /\b(inmigracion|imigracion|inmigrasion|migracion|greencard|green card|residencia|rezidencia|ciudadania|visa|permiso de trabajo|peticion familiar|corte de inmigracion|deportacion|deportar|estatus migratorio)\b/;

const LUIS_AUTO_ACCIDENT_PATTERN =
  /\b(accidente|acidente|choque|choke|chocaron|choco|chocado|atropellaron|atropello|me chocaron|me pego un carro)\b/;

const LUIS_DUI_CRIMINAL_PATTERN =
  /\b(dui|arresto|arrestaron|arestaron|me arrestaron|cargo criminal|cargos criminales|citacion|detencion|me detuvieron|corte criminal|me paro la policia|tome y maneje|manejando tomado)\b/;

const LUIS_BENEFIT_KEY_PATTERNS: ReadonlyArray<readonly [RegExp, LuisBenefitKey]> = [
  [/\b(supermercado|super mercado|mandado|groceries)\b/, "SUPERMARKET"],
  [/\b(dental|dentista|dientes|limpieza dental)\b/, "DENTAL"],
  [/\b(medico|medica|urgencias medicas)\b/, "MEDICAL"],
  [/\b(envio|shipping|paquete|encomienda)\b/, "SHIPPING"],
];
const LUIS_BENEFITS_GENERIC_PATTERN = /\b(cupon|cupones|beneficio|beneficios|descuento|descuentos|promocion|promociones)\b/;

// A generic mention of needing legal help with no specific topic signal -
// checked AFTER the specific patterns above, so any message that also names
// a topic (immigration/accident/DUI/criminal) is always classified by the
// specific pattern instead of falling into this generic bucket.
const LUIS_LEGAL_GENERIC_PATTERN =
  /\b(ayuda legal|asesoria legal|asesoramiento legal|abogado|abogada|caso legal|problema legal|situacion legal|asunto legal)\b/;

const LUIS_NEGATION_WORDS = /^(no|nunca|jamas|tampoco)$/;
// A contrastive word between a negation and the keyword cancels the
// negation, so "no tengo miedo pero tuve un accidente" still detects the
// accident instead of being blocked by the earlier "no".
const LUIS_NEGATION_RESET_WORDS = /^(pero|aunque)$/;

// Looks at the words immediately before a keyword match for a negation word
// (no/nunca/jamas/tampoco) so "No tuve ningun accidente" / "No necesito
// inmigracion" are not treated as evidence for the intent they explicitly
// deny. Deliberately a small bounded backward window, not a full grammar
// parse - explainable and easy to extend.
function isNegatedMatch(normalized: string, matchIndex: number): boolean {
  const precedingWords = normalized.slice(0, matchIndex).trim().split(/\s+/).filter(Boolean).slice(-5);
  let negated = false;
  for (const word of precedingWords) {
    if (LUIS_NEGATION_RESET_WORDS.test(word)) negated = false;
    else if (LUIS_NEGATION_WORDS.test(word)) negated = true;
  }
  return negated;
}

// True when `pattern` matches `normalized` with at least one occurrence
// that isn't preceded by a nearby negation word.
function hasUnnegatedMatch(normalized: string, pattern: RegExp): boolean {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let match: RegExpExecArray | null;
  while ((match = global.exec(normalized))) {
    if (!isNegatedMatch(normalized, match.index)) return true;
    if (match.index === global.lastIndex) global.lastIndex++;
  }
  return false;
}

// A message reporting that a THIRD PARTY (not the sender) is the one with
// the legal situation must not be silently treated as the sender's own
// intake - e.g. "Mi primo tuvo un accidente y no se que hacer" should
// clarify whether the sender wants help for themselves, not auto-register
// them as the accident victim. Bounded to explicit third-person-referent
// phrases immediately followed by a situation verb, not a general parse.
const LUIS_THIRD_PARTY_REFERENT_PATTERN =
  /\b(mi primo|mi prima|mi amigo|mi amiga|mi hermano|mi hermana|mi papa|mi mama|mi esposo|mi esposa|mi vecino|mi vecina|un amigo|una amiga|un familiar|una persona que conozco|alguien que conozco)\b(?:\s+\w+){0,4}\s+\b(tuvo|tiene|le paso|esta pasando|lo arrestaron|la arrestaron)\b/;

export type LuisIntentRuleCategory =
  | "menu_or_greeting"
  | "immigration_keyword"
  | "auto_accident_keyword"
  | "dui_criminal_keyword"
  | "legal_generic_keyword"
  | "benefit_keyword"
  | "benefit_generic_keyword"
  | "handoff_keyword"
  | "none";

type LuisIntentClassification = {
  intent: LuisIntent;
  ruleCategory: LuisIntentRuleCategory;
  negationBlockedCandidate: boolean;
  thirdPartyReferentDetected: boolean;
};

// Shared internal classifier used by both interpretLuisIntent (the routing
// contract) and diagnoseLuisIntentRoute (sanitized logging only) so the two
// can never drift apart into two different rulesets.
function classifyLuisIntentDetailed(inboundText: unknown): LuisIntentClassification {
  const normalized = normalizedLuisText(inboundText);
  const none = (intent: LuisIntent, ruleCategory: LuisIntentRuleCategory = "none"): LuisIntentClassification => ({
    intent,
    ruleCategory,
    negationBlockedCandidate: false,
    thirdPartyReferentDetected: false,
  });
  if (!normalized) return none({ kind: "GENERAL_ENTRY" });
  if (
    isLuisMainMenuCommand(inboundText) ||
    isLuisGreetingCommand(inboundText) ||
    isLuisMenuRequestText(inboundText)
  ) {
    return none({ kind: "MENU" }, "menu_or_greeting");
  }

  const thirdPartyReferent = LUIS_THIRD_PARTY_REFERENT_PATTERN.test(normalized);

  // Strong, specific service intent takes priority over a generic handoff
  // request bundled in the same message (Part 6: route to the specific
  // intake rather than a vague handoff when both are plausible).
  const topicChecks: ReadonlyArray<readonly [RegExp, LuisIntent, LuisIntentRuleCategory]> = [
    [LUIS_IMMIGRATION_PATTERN, { kind: "IMMIGRATION" }, "immigration_keyword"],
    [LUIS_AUTO_ACCIDENT_PATTERN, { kind: "AUTO_ACCIDENT" }, "auto_accident_keyword"],
    [LUIS_DUI_CRIMINAL_PATTERN, { kind: "DUI_CRIMINAL" }, "dui_criminal_keyword"],
  ];
  for (const [pattern, intent, ruleCategory] of topicChecks) {
    if (!pattern.test(normalized)) continue;
    if (!hasUnnegatedMatch(normalized, pattern)) {
      return { intent: { kind: "GENERAL_ENTRY" }, ruleCategory, negationBlockedCandidate: true, thirdPartyReferentDetected: false };
    }
    // A confident topic signal about someone ELSE's situation asks for
    // clarification instead of opening the intake on the sender's behalf.
    if (thirdPartyReferent) {
      return { intent: { kind: "LEGAL_AMBIGUOUS" }, ruleCategory, negationBlockedCandidate: false, thirdPartyReferentDetected: true };
    }
    return none(intent, ruleCategory);
  }

  if (LUIS_LEGAL_GENERIC_PATTERN.test(normalized)) {
    if (!hasUnnegatedMatch(normalized, LUIS_LEGAL_GENERIC_PATTERN)) {
      return { intent: { kind: "GENERAL_ENTRY" }, ruleCategory: "legal_generic_keyword", negationBlockedCandidate: true, thirdPartyReferentDetected: false };
    }
    return none({ kind: "LEGAL_AMBIGUOUS" }, "legal_generic_keyword");
  }

  for (const [pattern, benefitKey] of LUIS_BENEFIT_KEY_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    if (!hasUnnegatedMatch(normalized, pattern)) {
      return { intent: { kind: "GENERAL_ENTRY" }, ruleCategory: "benefit_keyword", negationBlockedCandidate: true, thirdPartyReferentDetected: false };
    }
    return none({ kind: "BENEFITS", benefitKey }, "benefit_keyword");
  }
  if (LUIS_BENEFITS_GENERIC_PATTERN.test(normalized)) {
    if (!hasUnnegatedMatch(normalized, LUIS_BENEFITS_GENERIC_PATTERN)) {
      return { intent: { kind: "GENERAL_ENTRY" }, ruleCategory: "benefit_generic_keyword", negationBlockedCandidate: true, thirdPartyReferentDetected: false };
    }
    return none({ kind: "BENEFITS" }, "benefit_generic_keyword");
  }

  if (LUIS_HANDOFF_PATTERN.test(normalized) || LUIS_HANDOFF_PERSON_PATTERN.test(normalized)) {
    return none({ kind: "HANDOFF" }, "handoff_keyword");
  }

  // Everything else - "Necesito ayuda", "Qué servicios tienen", "Tengo una
  // consulta", or any other ordinary free text without a confident specific
  // signal - is the safe fallback per Part 3 priorities 5-6.
  return none({ kind: "GENERAL_ENTRY" });
}

/**
 * Pure classifier: text in, closed LuisIntent out. Never mutates state,
 * never performs an action - routeLuisConversation is the only caller and
 * decides what LuisConversationRoute (and eventually which existing
 * deterministic handler) each intent maps to.
 */
export function interpretLuisIntent(args: {
  inboundText: unknown;
}): LuisIntent {
  return classifyLuisIntentDetailed(args.inboundText).intent;
}

export type LuisIntentRouteDiagnostic = {
  selectedIntentKind: LuisIntent["kind"];
  matchedRuleCategory: LuisIntentRuleCategory;
  negationBlockedCandidate: boolean;
  thirdPartyReferentDetected: boolean;
};

// Sanitized diagnostics only: booleans/enums/categories, never the raw
// customer message, name, phone, or any other personal data. Mirrors the
// existing diagnoseLuisBenefitFlowCompletionFailure pattern - a read-only
// parallel function, never mixed into the routing return contract itself.
export function diagnoseLuisIntentRoute(args: { inboundText: unknown }): LuisIntentRouteDiagnostic {
  const classification = classifyLuisIntentDetailed(args.inboundText);
  return {
    selectedIntentKind: classification.intent.kind,
    matchedRuleCategory: classification.ruleCategory,
    negationBlockedCandidate: classification.negationBlockedCandidate,
    thirdPartyReferentDetected: classification.thirdPartyReferentDetected,
  };
}

/**
 * Distinguishes a genuinely ACTIVE pending legal intake step (the system
 * just asked this exact question and nextExpected still points at it) from
 * STALE leftover state that must not hijack an unrelated later message.
 * nextExpected is Luis's own canonical "what turn is currently expected"
 * field (already used this way everywhere else in run-replies); it is only
 * ever written by Luis-specific handlers for this org, and luisLegalPatch
 * always sets it atomically together with collected.luis_legal, so it is a
 * reliable existing signal - no new timestamp/migration is introduced.
 */
export function isLuisLegalIntakeActive(args: {
  legalState?: LuisLegalState | null;
  nextExpected?: unknown;
}): boolean {
  const legal = args.legalState;
  if (!legal || !legal.topic || legal.step === "completed" || !legal.step) return false;
  return normalizedLuisText(args.nextExpected) === "luis legal";
}

// Priority 2 (Part 3/Part 8): explicit configured campaign/deep-link
// triggers, structured as a lookup so future triggers (PROMO, CUPON20,
// DENTAL29, ...) can be added here with a higher priority than general
// interpretation, without touching the interpreter or reordering anything.
const LUIS_CAMPAIGN_TRIGGERS: Record<string, LuisConversationRoute> = {
  "hola quiero activar mis beneficios": { kind: "benefits", directCampaignEntry: true },
};

/**
 * Stateless routing for the Luis WhatsApp shell.  Benefit claims deliberately
 * stay out of this router; it only chooses the next conversational step.
 */
export function routeLuisConversation(args: {
  inboundText: unknown;
  payloadAction?: unknown;
  legalState?: LuisLegalState | null;
  nextExpected?: unknown;
}): LuisConversationRoute {
  const inbound = normalizedLuisText(args.inboundText);
  const action = normalizedLuisText(args.payloadAction);
  const legal = args.legalState ?? {};

  // Priority 1: explicit WhatsApp payload/action - unchanged, highest
  // precedence, never touched by the interpreter.
  // Production hotfix: luis_benefits:another normalizes to "luis benefits
  // another" — checked here, ahead of everything else, so it can never fall
  // through to the pre-existing "luis benefits another" match below (which
  // routes to {kind:"benefits"} and could reach an invalid screen — see
  // the post_benefit_reopen_benefits doc comment above).
  if (action === "luis benefits another") return { kind: "post_benefit_reopen_benefits" };
  if (action === "luis benefits main menu") return { kind: "post_benefit_menu" };
  if (action === "luis benefits services") return { kind: "post_benefit_services" };
  if (action === "luis benefits finalize") return { kind: "post_benefit_finalize" };
  if (action === "luis nearest confirm") return { kind: "nearest_supermarket_confirm" };
  if (action === "luis nearest reject") return { kind: "nearest_supermarket_reject" };
  // A bare greeting ("Hola") is its own trigger, distinct from an explicit
  // menu request - checked first so "Hola" alone is never misclassified as
  // "explicit" even though isLuisMenuRequestText's \bmenu\b-adjacent
  // patterns don't overlap it anyway; kept as an explicit priority for
  // clarity, not because of an actual pattern collision today.
  if (isLuisGreetingCommand(args.inboundText)) {
    return { kind: "main_menu", trigger: "greeting" };
  }
  if (
    isLuisMainMenuCommand(args.inboundText) ||
    isLuisMenuRequestText(args.inboundText) ||
    action === "luis main menu"
  ) {
    return { kind: "main_menu", trigger: "explicit" };
  }
  // "luis benefits another" removed from this OR — it's now matched
  // earlier, unreachable here by construction (see post_benefit_reopen_
  // benefits above). "luis main benefits" (a distinct trigger — the
  // luis_main:benefits main-menu button, not the post-benefit-delivery
  // "Ver beneficios") is unchanged.
  if (action === "luis main benefits") {
    return { kind: "benefits" };
  }
  // Taps on the benefits_clarify buttons ("Supermercado"/"Médico"/"Ver
  // otros") - all three open the same Flow entry point the customer would
  // reach from an explicit text request (verified against Meta's routing-
  // model rules: BENEFIT_SELECT/BENEFIT_DETAILS both require an inbound
  // edge, so neither qualifies as a directly-targetable entry screen - see
  // the requestedBenefitKey comment on LuisConversationRoute). Threading
  // through WHICH specific benefit was tapped lets the caller show a
  // contextual greeting/CTA ("tu beneficio de supermercado") even though
  // the customer still has to pick it again inside the Flow - "Ver otros"
  // deliberately carries no key, since it explicitly means "show me all 4".
  if (action === "luis benefits clarify supermarket") {
    return { kind: "benefits", requestedBenefitKey: "SUPERMARKET" };
  }
  if (action === "luis benefits clarify medical") {
    return { kind: "benefits", requestedBenefitKey: "MEDICAL" };
  }
  if (action === "luis benefits clarify other") {
    return { kind: "benefits" };
  }
  if (action === "luis main team") return { kind: "human_handoff" };
  if (action === "luis main legal") return { kind: "legal_menu" };
  if (action === "luis legal immigration") {
    return { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" };
  }
  if (action === "luis legal criminal") {
    return { kind: "legal_prompt", topic: "CRIMINAL", step: "description" };
  }
  if (action === "luis legal accident") {
    return { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" };
  }
  if (action === "luis legal accident medical yes") {
    return { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_location" };
  }
  if (action === "luis legal accident medical no") {
    return { kind: "legal_complete", topic: "AUTO_ACCIDENT" };
  }

  // Emergency redirect is a safety feature, unconditional on active/stale -
  // unchanged scope from before (fires whenever a legal topic is engaged
  // at all, same as the original implementation).
  if (legal.topic && isLuisEmergencyText(args.inboundText)) return { kind: "legal_emergency" };

  // Priority 2: explicit configured campaign trigger.
  if (LUIS_CAMPAIGN_TRIGGERS[inbound]) return LUIS_CAMPAIGN_TRIGGERS[inbound];

  // Priority 3: a genuinely ACTIVE pending intake step consumes the text as
  // its answer - internals unchanged from before, now correctly gated so
  // STALE leftover state (nextExpected no longer "luis_legal") can never
  // reach this block and hijack an unrelated later message.
  if (
    legal.topic &&
    isLuisLegalIntakeActive({ legalState: args.legalState, nextExpected: args.nextExpected })
  ) {
    if (legal.topic === "AUTO_ACCIDENT" && legal.step === "date") {
      return inbound
        ? { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_attention" }
        : { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" };
    }
    if (legal.topic === "AUTO_ACCIDENT" && legal.step === "medical_attention") {
      if (/^(si|yes)$/i.test(inbound)) {
        return { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_location" };
      }
      if (/^(no)$/i.test(inbound)) return { kind: "legal_complete", topic: "AUTO_ACCIDENT" };
      return { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_attention" };
    }
    if (legal.topic === "AUTO_ACCIDENT" && legal.step === "medical_location") {
      return inbound
        ? { kind: "legal_complete", topic: "AUTO_ACCIDENT" }
        : { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_location" };
    }
    if (legal.step === "description") {
      return inbound
        ? { kind: "legal_complete", topic: legal.topic }
        : { kind: "legal_prompt", topic: legal.topic, step: "description" };
    }
  }

  // Priorities 4-6: natural-language interpretation. interpretLuisIntent
  // already classifies free text correctly (e.g. "Hola recientemente tuve
  // un accidente de auto" -> AUTO_ACCIDENT even though the message starts
  // with a greeting word, since isLuisGreetingCommand above only matches a
  // BARE greeting) - this block now actually acts on that classification
  // instead of discarding it. It routes to the EXISTING, already-
  // functional, non-Meta-Flow text intake (legal_prompt/legal_menu - the
  // same targets Priority-1 actions "luis legal immigration/accident/
  // criminal"/"luis main legal" already reach) and the EXISTING standalone
  // Benefits Flow ({kind:"benefits"} - the same target Priority-1 action
  // "luis main benefits" already reaches). This is never a deep link into a
  // non-entry screen of the Unified Services Flow, so the prior "no
  // verified-safe deep-link" concern (still true, still unaddressed) simply
  // does not apply to this change - no Meta Flow is touched.
  const intent = interpretLuisIntent({ inboundText: args.inboundText });
  if (intent.kind === "HANDOFF") return { kind: "human_handoff" };
  if (intent.kind === "IMMIGRATION") {
    return { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" };
  }
  if (intent.kind === "AUTO_ACCIDENT") {
    return { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" };
  }
  if (intent.kind === "DUI_CRIMINAL") {
    return { kind: "legal_prompt", topic: "CRIMINAL", step: "description" };
  }
  // Generic legal mention, or a specific topic downgraded because the
  // sender described a third party's situation - ask, don't guess.
  if (intent.kind === "LEGAL_AMBIGUOUS") return { kind: "legal_menu" };
  // A SPECIFIC benefit request ("cupón de supermercado", "beneficio
  // médico") opens the standalone Benefits Flow directly - benefitKey
  // itself is not threaded through (the Flow has no pre-selection entry
  // point today; adding one would mean changing the Flow, out of scope),
  // but the customer picks their already-named benefit on the very next
  // screen. A GENERIC mention ("quiero un cupón", with no benefit named)
  // asks which benefit first instead of guessing which of the 4 to imply.
  if (intent.kind === "BENEFITS") {
    return intent.benefitKey
      ? { kind: "benefits", requestedBenefitKey: intent.benefitKey }
      : { kind: "benefits_clarify" };
  }
  // GENERAL_ENTRY: ordinary free text without a confident specific signal
  // ("Necesito ayuda", empty text on first contact, etc.) - not a
  // recognized greeting word, so it keeps the existing "explicit" reentry
  // behavior rather than guessing this was meant as a greeting.
  return { kind: "main_menu", trigger: "explicit" };
}

export function parseLuisBenefitFlowCompletion(
  raw: unknown,
): LuisBenefitFlowCompletion | null {
  const value = record(raw);
  if (!value) return null;
  const benefitKey = text(value.benefit_key, 32) as LuisBenefitKey;
  const fullName = text(value.full_name, 120);
  const postalCode = postalCodeText(value.postal_code);
  const rawEmail = value.email === null || value.email === undefined
    ? ""
    : text(value.email, 254).toLowerCase();
  // Meta Flow OptIn values are serialized as booleans in some clients and as
  // literal strings (or omitted when unchecked) in others. Canonicalize only
  // these exact non-secret representations; every other value remains invalid.
  const marketingConsent = value.marketing_consent === true ||
      value.marketing_consent === "true"
    ? true
    : value.marketing_consent === false || value.marketing_consent === "false" ||
        value.marketing_consent === null || value.marketing_consent === undefined ||
        value.marketing_consent === ""
    ? false
    : null;
  if (
    !Object.prototype.hasOwnProperty.call(LUIS_BENEFITS, benefitKey) ||
    !fullName || !/^\d{5}$/.test(postalCode) ||
    (rawEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) ||
    marketingConsent === null
  ) return null;
  if (marketingConsent && !rawEmail) return null;
  return {
    benefit_key: benefitKey,
    full_name: fullName,
    postal_code: postalCode,
    email: rawEmail || null,
    marketing_consent: marketingConsent,
  };
}

// Sanitized diagnostic for the "No pudimos validar tu beneficio" branch -
// never returns any raw field value (name/email/postal_code), only which
// specific rule rejected the submission, so a real failure like Juliana's
// (2026-08-25) can be pinpointed from logs instead of guessed at. Mirrors
// parseLuisBenefitFlowCompletion's exact validation, on purpose kept as a
// second read-only pass rather than refactoring the parser itself, so the
// parser's proven contract/callers are untouched.
export type LuisBenefitFlowCompletionDiagnostic = {
  hasPayload: boolean;
  benefitKeyValid: boolean;
  fullNamePresent: boolean;
  postalCodeValid: boolean;
  postalCodeRawType: "string" | "number" | "other";
  emailProvided: boolean;
  emailValid: boolean;
  marketingConsentRawType: "boolean" | "string" | "null_or_missing" | "other";
  marketingConsentValid: boolean;
  marketingConsentRequiresEmailButMissing: boolean;
};

export function diagnoseLuisBenefitFlowCompletionFailure(
  raw: unknown,
): LuisBenefitFlowCompletionDiagnostic {
  const value = record(raw);
  if (!value) {
    return {
      hasPayload: false,
      benefitKeyValid: false,
      fullNamePresent: false,
      postalCodeValid: false,
      postalCodeRawType: "other",
      emailProvided: false,
      emailValid: false,
      marketingConsentRawType: "other",
      marketingConsentValid: false,
      marketingConsentRequiresEmailButMissing: false,
    };
  }
  const benefitKey = text(value.benefit_key, 32) as LuisBenefitKey;
  const fullName = text(value.full_name, 120);
  const postalCode = postalCodeText(value.postal_code);
  const rawEmail = value.email === null || value.email === undefined
    ? ""
    : text(value.email, 254).toLowerCase();
  const marketingConsent = value.marketing_consent === true ||
      value.marketing_consent === "true"
    ? true
    : value.marketing_consent === false || value.marketing_consent === "false" ||
        value.marketing_consent === null || value.marketing_consent === undefined ||
        value.marketing_consent === ""
    ? false
    : null;
  const emailValid = !rawEmail || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail);
  return {
    hasPayload: true,
    benefitKeyValid: Object.prototype.hasOwnProperty.call(LUIS_BENEFITS, benefitKey),
    fullNamePresent: Boolean(fullName),
    postalCodeValid: /^\d{5}$/.test(postalCode),
    postalCodeRawType: typeof value.postal_code === "string"
      ? "string"
      : typeof value.postal_code === "number"
      ? "number"
      : "other",
    emailProvided: Boolean(rawEmail),
    emailValid,
    marketingConsentRawType: typeof value.marketing_consent === "boolean"
      ? "boolean"
      : typeof value.marketing_consent === "string"
      ? "string"
      : value.marketing_consent === null || value.marketing_consent === undefined
      ? "null_or_missing"
      : "other",
    marketingConsentValid: marketingConsent !== null,
    marketingConsentRequiresEmailButMissing: marketingConsent === true && !rawEmail,
  };
}

export function classifyLuisFlowCompletion(raw: unknown): LuisFlowCompletionKind {
  const value = record(raw);
  if (!value) return "UNKNOWN";
  const intakeType = text(value.intake_type, 32);
  const hasBenefitKey = Object.prototype.hasOwnProperty.call(value, "benefit_key");
  const hasIntakeType = Object.prototype.hasOwnProperty.call(value, "intake_type");
  if (hasBenefitKey && hasIntakeType) return "UNKNOWN";
  if (["IMMIGRATION", "AUTO_ACCIDENT", "DUI_CRIMINAL"].includes(intakeType)) {
    return "LEGAL";
  }
  if (hasBenefitKey) return "BENEFITS";
  if (!hasIntakeType && !hasBenefitKey && text(value.service_key, 32) === "FURNITURE") return "FURNITURE";
  // Unified Flow HANDOFF_CONFIRM completes with only {service_key: "HANDOFF"} -
  // no benefit_key/intake_type, so it never collides with the branches above.
  if (!hasIntakeType && text(value.service_key, 32) === "HANDOFF") return "HANDOFF";
  if (!hasIntakeType && !hasBenefitKey && text(value.service_key, 32) === "MERCADITO") return "MERCADITO";
  return "UNKNOWN";
}

export function parseLuisFurnitureFlowCompletion(raw: unknown): LuisFurnitureFlowCompletion | null {
  const value = record(raw);
  if (!value || text(value.service_key, 32) !== "FURNITURE") return null;
  const fullName = text(value.full_name, 120);
  const postalCode = postalCodeText(value.postal_code);
  return fullName && /^\d{5}$/.test(postalCode)
    ? { service_key: "FURNITURE", full_name: fullName, postal_code: postalCode }
    : null;
}

function optionalPostalCode(value: unknown) {
  // Immigration's optional Flow ZIP is now explicitly a text input. Keep
  // historical numeric payloads compatible, but normalize every accepted
  // value to the canonical string persisted by the bridge.
  const postalCode = value === null || value === undefined ? "" : postalCodeText(value);
  return !postalCode ? null : /^\d{5}$/.test(postalCode) ? postalCode : undefined;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]) {
  const candidate = text(value, 100) as T;
  return choices.includes(candidate) ? candidate : null;
}

// Absent (null/undefined) is a valid "not provided" for every V1
// micro-intake structured field — never fails the whole completion parse.
// A present-but-invalid value is treated the same as absent (returns null)
// rather than rejecting the entire completion, since none of these fields
// are load-bearing for identity/consent.
function optionalOneOf<T extends string>(value: unknown, choices: readonly T[]): T | null {
  if (value === null || value === undefined) return null;
  return oneOf(value, choices);
}

export function parseLuisLegalFlowCompletion(
  raw: unknown,
): LuisLegalFlowCompletion | null {
  const value = record(raw);
  if (!value) return null;
  const intakeType = text(value.intake_type, 32);
  const fullName = text(value.full_name, 120);
  const description = text(value.description, 600);
  if (!fullName || !description) return null;
  if (intakeType === "IMMIGRATION") {
    const topic = oneOf(value.topic, [
      "CONSULTATION",
      "GREEN_CARD",
      "CITIZENSHIP",
      "WORK_PERMIT",
      "FAMILY_PETITION",
      "IMMIGRATION_COURT",
      "OTHER",
      "FAMILY_GREEN_CARD",
      "GREEN_CARD_RENEWAL",
      "ASYLUM",
      "U_VISA",
    ] as const);
    const postalCode = optionalPostalCode(value.postal_code);
    const submittedConsent = oneOf(value.sharing_consent, ["AUTHORIZED", "DECLINED"] as const);
    const sharingConsent = submittedConsent ?? "PENDING";
    const consentVersion = submittedConsent ? text(value.consent_version, 80) || null : null;
    const consentSource = submittedConsent ? text(value.consent_source, 40) || null : null;
    return topic && postalCode !== undefined
      ? {
        intake_type: "IMMIGRATION", topic, full_name: fullName, postal_code: postalCode, description,
        sharing_consent: sharingConsent, consent_version: consentVersion, consent_source: consentSource,
        resident_duration: optionalOneOf(value.resident_duration, ["LESS_THAN_3_YEARS", "THREE_TO_FIVE_YEARS", "MORE_THAN_5_YEARS"] as const),
        long_absence: optionalOneOf(value.long_absence, ["YES", "NO", "NOT_SURE"] as const),
        citizenship_marriage_basis: optionalOneOf(value.citizenship_marriage_basis, ["YES", "NO", "NOT_SURE"] as const),
        petitioner_relationship: optionalOneOf(value.petitioner_relationship, ["US_CITIZEN_SPOUSE", "RESIDENT_SPOUSE", "PARENT", "ADULT_CHILD", "OTHER", "NOT_SURE"] as const),
        entry_method: optionalOneOf(value.entry_method, ["VISA", "PAROLE", "WITHOUT_INSPECTION", "NOT_SURE"] as const),
        prior_uscis_petition: optionalOneOf(value.prior_uscis_petition, ["YES", "NO", "NOT_SURE"] as const),
        green_card_term: optionalOneOf(value.green_card_term, ["TWO_YEAR", "TEN_YEAR", "NOT_SURE"] as const),
        green_card_issue: optionalOneOf(value.green_card_issue, ["EXPIRING", "EXPIRED", "LOST_OR_STOLEN", "DAMAGED", "OTHER"] as const),
        prior_related_filing: optionalOneOf(value.prior_related_filing, ["YES", "NO", "NOT_SURE"] as const),
        arrival_window: optionalOneOf(value.arrival_window, ["LESS_THAN_ONE_YEAR", "MORE_THAN_ONE_YEAR", "NOT_SURE"] as const),
        fear_reason: optionalOneOf(value.fear_reason, ["POLITICAL", "RELIGION", "NATIONALITY", "RACE", "SOCIAL_GROUP", "OTHER", "NOT_SURE"] as const),
        immigration_court_status: optionalOneOf(value.immigration_court_status, ["YES", "NO", "NOT_SURE"] as const),
        crime_victim: optionalOneOf(value.crime_victim, ["YES", "NO", "NOT_SURE"] as const),
        police_report: optionalOneOf(value.police_report, ["YES", "NO", "NOT_SURE"] as const),
        law_enforcement_cooperation: optionalOneOf(value.law_enforcement_cooperation, ["YES", "NO", "NOT_SURE"] as const),
        work_permit_request_type: optionalOneOf(value.work_permit_request_type, ["FIRST_APPLICATION", "RENEWAL", "REPLACEMENT"] as const),
        work_permit_basis: optionalOneOf(value.work_permit_basis, ["ASYLUM", "ADJUSTMENT", "TPS", "OTHER", "NOT_SURE"] as const),
        work_permit_status: optionalOneOf(value.work_permit_status, ["VALID", "EXPIRING", "EXPIRED", "NONE", "NOT_SURE"] as const),
      }
      : null;
  }
  if (intakeType === "AUTO_ACCIDENT") {
    const accidentDate = text(value.accident_date, 32);
    // Current/legacy payloads may use `participation`; accept that shape
    // while canonicalizing the stored intake to `participant_role`. Neither
    // is asked by the V1 micro-intake UI anymore — both are optional now.
    const participantRole = optionalOneOf(
      value.participant_role ?? value.participation,
      ["DRIVER", "PASSENGER", "OTHER"] as const,
    );
    const receivedMedicalAttention = oneOf(value.received_medical_attention, ["YES", "NO"] as const);
    const medicalProvider = value.medical_provider === null || value.medical_provider === undefined
      ? null
      : text(value.medical_provider, 160) || null;
    const policeReport = optionalOneOf(value.police_report, ["YES", "NO", "NOT_SURE"] as const);
    const postalCode = optionalPostalCode(value.postal_code);
    const submittedConsent = oneOf(value.sharing_consent, ["AUTHORIZED", "DECLINED"] as const);
    const sharingConsent = submittedConsent ?? "PENDING";
    const consentVersion = submittedConsent ? text(value.consent_version, 80) || null : null;
    const consentSource = submittedConsent ? text(value.consent_source, 40) || null : null;
    return /^\d{4}-\d{2}-\d{2}$/.test(accidentDate) && receivedMedicalAttention && postalCode !== undefined
      ? {
        intake_type: "AUTO_ACCIDENT",
        full_name: fullName,
        postal_code: postalCode,
        accident_date: accidentDate,
        participant_role: participantRole,
        received_medical_attention: receivedMedicalAttention,
        medical_provider: medicalProvider,
        police_report: policeReport,
        description,
        sharing_consent: sharingConsent,
        consent_version: consentVersion,
        consent_source: consentSource,
      }
      : null;
  }
  if (intakeType === "DUI_CRIMINAL") {
    const topic = oneOf(value.topic, ["DUI", "ARREST", "CRIMINAL_CHARGE", "COURT_SUMMONS", "OTHER"] as const);
    const postalCode = optionalPostalCode(value.postal_code);
    return topic && postalCode !== undefined
      ? { intake_type: "DUI_CRIMINAL", topic, full_name: fullName, postal_code: postalCode, description }
      : null;
  }
  if (intakeType === "DUI") {
    const duiDate = text(value.dui_date, 32);
    const chemicalTest = oneOf(value.chemical_test, ["COMPLETED", "REFUSED", "NOT_SURE"] as const);
    const courtDateStatus = oneOf(value.court_date_status, ["YES", "NO", "NOT_SURE"] as const);
    const postalCode = optionalPostalCode(value.postal_code);
    const submittedConsent = oneOf(value.sharing_consent, ["AUTHORIZED", "DECLINED"] as const);
    const sharingConsent = submittedConsent ?? "PENDING";
    const consentVersion = submittedConsent ? text(value.consent_version, 80) || null : null;
    const consentSource = submittedConsent ? text(value.consent_source, 40) || null : null;
    return duiDate && chemicalTest && courtDateStatus && postalCode !== undefined
      ? {
        intake_type: "DUI", full_name: fullName, postal_code: postalCode, dui_date: duiDate,
        chemical_test: chemicalTest, court_date_status: courtDateStatus, description,
        sharing_consent: sharingConsent, consent_version: consentVersion, consent_source: consentSource,
      }
      : null;
  }
  if (intakeType === "CRIMINAL") {
    const criminalCharge = text(value.criminal_charge, 200);
    const courtDateStatus = oneOf(value.court_date_status, ["YES", "NO", "NOT_SURE"] as const);
    const currentlyDetained = oneOf(value.currently_detained, ["YES", "NO"] as const);
    const postalCode = optionalPostalCode(value.postal_code);
    const submittedConsent = oneOf(value.sharing_consent, ["AUTHORIZED", "DECLINED"] as const);
    const sharingConsent = submittedConsent ?? "PENDING";
    const consentVersion = submittedConsent ? text(value.consent_version, 80) || null : null;
    const consentSource = submittedConsent ? text(value.consent_source, 40) || null : null;
    return criminalCharge && courtDateStatus && currentlyDetained && postalCode !== undefined
      ? {
        intake_type: "CRIMINAL", full_name: fullName, postal_code: postalCode, criminal_charge: criminalCharge,
        court_date_status: courtDateStatus, currently_detained: currentlyDetained, description,
        sharing_consent: sharingConsent, consent_version: consentVersion, consent_source: consentSource,
      }
      : null;
  }
  return null;
}

// Pure, unit-testable image/name precedence rules for the DB-driven coupon
// cutover. A location-aware benefit (any campaign with active
// referral_benefit_campaign_locations rows — currently SUPERMARKET and
// MABLETON_PARRILLADA) never reaches the "db" branch of either helper — its
// image/location are exclusively resolved by request_referral_benefit_claim
// via rpcOfficialMediaUrl (exact-ZIP match) or the requires_location_verification
// early-return in buildLuisBenefitsFlowCompletionResult; neither helper here
// changes that. See supabase/functions/run-replies/tests/couponImagePrecedence.test.ts.
export function resolveCouponMediaUrl(args: {
  isLocationAware: boolean;
  rpcOfficialMediaUrl: string;
  dbImageUrl: string;
  hardcodedFallback: string;
}): string {
  if (args.rpcOfficialMediaUrl) return args.rpcOfficialMediaUrl;
  if (!args.isLocationAware && args.dbImageUrl) return args.dbImageUrl;
  return args.hardcodedFallback;
}

export function resolveCouponPartnerName(args: {
  rpcSupermarketLocationName: string;
  dbBusinessName: string;
  hardcodedFallback: string | null;
}): string | null {
  return args.rpcSupermarketLocationName || args.dbBusinessName || args.hardcodedFallback;
}

export function luisBenefitsActivationText(args: {
  firstName: string;
  benefitDisplayName: string;
  claimCode: string;
  partnerName?: string | null;
}) {
  const firstName = text(args.firstName, 60).split(" ")[0] || "";
  return [
    `¡Listo${firstName ? `, ${firstName}` : ""}! 🎉`,
    "Tu beneficio ya está activo.",
    args.benefitDisplayName,
    `Código de activación: ${args.claimCode}`,
    args.partnerName
      ? `Guardá este mensaje y presentá tu beneficio en ${text(args.partnerName, 160)}.`
      : "Guardá este mensaje y presentá tu beneficio con el negocio participante.",
  ].join("\n\n");
}

export function luisBenefitsFlowCta(flowId: string) {
  const id = text(flowId, 100);
  if (!id) return null;
  return {
    flowId: id,
    ctaText: "Ver beneficios",
    bodyText: "Elegí otro beneficio disponible.",
    flowAction: "navigate" as const,
    flowActionPayload: { screen: LUIS_BENEFITS_FLOW_SCREEN },
  };
}

export const LUIS_UNIFIED_FLOW_ENTRY_SCREEN = "SERVICE_SELECT";

// Direct-entry screens proposed in the 2026-08-26 draft Flow change (see
// docs/proposed-migrations/20260826_draft_luis_unified_services_flow_direct_entry_screens.{json,md}).
// NOT YET LIVE on the published Flow (flow_id 2465563120620708) — these
// names only exist in the local draft. Do not pass them to
// luisUnifiedFlowCta's `screen` argument in any code path that reaches
// production until that Flow change has been approved, uploaded, published,
// and confirmed live (health_status.can_send_message === "AVAILABLE").
// Deploying run-replies with these screen names before the Flow exists
// would send WhatsApp a flow_action_payload.screen the live Flow rejects.
export const LUIS_UNIFIED_FLOW_DIRECT_ENTRY_SCREENS: Partial<Record<LuisBenefitKey, string>> = {
  SUPERMARKET: "SUPERMARKET_ENTRY",
  MEDICAL: "MEDICAL_ENTRY",
};
export const LUIS_UNIFIED_FLOW_BENEFITS_ENTRY_SCREEN = "BENEFITS_ENTRY";

const LUIS_UNIFIED_FLOW_DEFAULT_GREETING =
  "Hola 👋 Te saluda Luis Gabriel.\n\nQué gusto tenerte por aquí. Tocá el botón para ver cómo podemos ayudarte.";

/**
 * bodyText is what WhatsApp actually displays for this message (the send
 * path uses flowCta.bodyText, not the separate `reply` field, whenever a
 * flowCta is present) — so a caller that wants a shorter return-to-menu
 * greeting instead of the full first-contact intro MUST pass it here, not
 * just vary `reply`. `screen` defaults to the general entry screen; pass one
 * of the (currently draft-only, see note above) direct-entry screen names to
 * skip straight past SERVICE_SELECT once that Flow change is live.
 */
export function luisUnifiedFlowCta(flowId: string, bodyText?: string, ctaText?: string, screen?: string) {
  const id = text(flowId, 100);
  if (!id) return null;
  return {
    flowId: id,
    ctaText: text(ctaText, 30) || "Ver opciones",
    bodyText: text(bodyText, 1024) || LUIS_UNIFIED_FLOW_DEFAULT_GREETING,
    flowAction: "navigate" as const,
    flowActionPayload: { screen: text(screen, 100) || LUIS_UNIFIED_FLOW_ENTRY_SCREEN },
    // This is a unified services experience, not a booking-only product —
    // omit the generic "Agendá tu cita" header so the greeting in bodyText
    // is the only customer-facing wrapper copy.
    headerText: "",
  };
}
