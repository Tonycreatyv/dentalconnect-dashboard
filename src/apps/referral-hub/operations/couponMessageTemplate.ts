// COUPON MESSAGE TEMPLATE CONTRACT (v1)
//
// This module renders the customer-facing WhatsApp coupon message body from
// a staff-authored template string. It is intentionally a pure, dependency-
// free module: no imports, no database access, no network calls, no
// secrets, no LLM. This exact contract is implemented twice — once here
// (Deno, consumed by supabase/functions/run-replies) and once at
// src/apps/referral-hub/operations/couponMessageTemplate.ts (browser,
// consumed by the coupon editor's preview) — because a single physical
// file cannot safely be assumed to bundle into both the Vite frontend and
// the deployed edge function. The two files must stay byte-identical in
// behavior; supabase/functions/run-replies/tests/couponMessageTemplateParity.test.ts
// imports both and asserts they produce identical output for shared fixtures.
//
// Syntax:
//   {{placeholder}}            - flat substitution, replaced with the value.
//   {{#placeholder}}...{{/placeholder}} - optional segment: the enclosed
//                                 literal text (itself placeholder-substituted)
//                                 is included only if `placeholder` resolves
//                                 to a non-empty (post-trim) value, otherwise
//                                 the whole segment (including its own
//                                 whitespace) is removed. Not nestable, not a
//                                 general expression language - this exists
//                                 solely to reproduce the one conditional in
//                                 the legacy greeting line ("¡Listo, X!" vs
//                                 "¡Listo!").
//
// Only the placeholders in KNOWN_PLACEHOLDERS are valid. Any other
// {{name}} or {{#name}}...{{/name}} in the template - a typo, a stray
// business-provided "{{...}}" fragment, anything - causes renderCouponMessage
// to throw rather than silently drop or pass it through. A substituted
// value is inserted literally and is never re-scanned for further
// placeholders (a business_name containing "{{claim_code}}" cannot inject
// a second substitution pass).

export const KNOWN_PLACEHOLDERS = [
  "customer_first_name",
  "business_name",
  "benefit_name",
  "claim_code",
  "address",
] as const;

export type CouponMessagePlaceholder = (typeof KNOWN_PLACEHOLDERS)[number];

export type CouponMessageValues = Partial<Record<CouponMessagePlaceholder, string>>;

function isKnownPlaceholder(name: string): name is CouponMessagePlaceholder {
  return (KNOWN_PLACEHOLDERS as readonly string[]).includes(name);
}

const BLOCK_PATTERN = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const FLAT_PATTERN = /\{\{(\w+)\}\}/g;

function substituteFlat(text: string, values: CouponMessageValues): string {
  return text.replace(FLAT_PATTERN, (_match, name: string) => {
    if (!isKnownPlaceholder(name)) {
      throw new Error(`Unknown placeholder in coupon message template: {{${name}}}`);
    }
    return values[name] ?? "";
  });
}

export function renderCouponMessage(template: string, values: CouponMessageValues): string {
  let output = template.replace(BLOCK_PATTERN, (_match, name: string, inner: string) => {
    if (!isKnownPlaceholder(name)) {
      throw new Error(`Unknown placeholder in coupon message template: {{${name}}}`);
    }
    const condition = (values[name] ?? "").trim();
    return condition ? substituteFlat(inner, values) : "";
  });
  output = substituteFlat(output, values);
  if (output.includes("{{") || output.includes("}}")) {
    throw new Error("Malformed coupon message template: unresolved \"{{\"/\"}}\" sequence remains.");
  }
  return output;
}
