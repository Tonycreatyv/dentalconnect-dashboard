// Mirrors the real completion-kind contract read by run-replies/index.ts
// (classifyLuisFlowCompletion / parseLuisBenefitFlowCompletion /
// parseLuisLegalFlowCompletion in supabase/functions/_products/referral-hub/
// luisBenefits.ts). Not imported directly — that file lives in the Deno
// function tree and pulls in Deno-only dependencies — so this is a
// deliberately small, independent read of the same field contract, used
// only to label real reply_outbox.payload.flow_response data for display.
// It never invents fields: any key it doesn't recognize is left out.

// Real benefit_key values submitted by the Flow, per LuisBenefitKey /
// LUIS_BENEFITS in supabase/functions/_products/referral-hub/luisBenefits.ts
// ("SUPERMARKET" | "MEDICAL" | "DENTAL" | "SHIPPING") — not the longer
// referral_coupon_campaigns.campaign_key strings.
const BENEFIT_LABELS: Record<string, string> = {
  SUPERMARKET: "$20 para tu compra de supermercado",
  MEDICAL: "20% de descuento en servicios médicos",
  DENTAL: "Consulta + limpieza + rayos X por $29",
  SHIPPING: "$20 de descuento en tu próximo envío",
};

const LEGAL_TOPIC_LABELS: Record<string, string> = {
  IMMIGRATION: "Inmigración",
  AUTO_ACCIDENT: "Accidente de auto",
  DUI_CRIMINAL: "DUI / Defensa criminal",
};

export type FlowSubmissionKind = "BENEFITS" | "LEGAL" | "HANDOFF" | "UNKNOWN";

export function classifyFlowSubmission(raw: unknown): FlowSubmissionKind {
  if (!raw || typeof raw !== "object") return "UNKNOWN";
  const value = raw as Record<string, unknown>;
  const hasBenefitKey = Object.prototype.hasOwnProperty.call(value, "benefit_key");
  const hasIntakeType = Object.prototype.hasOwnProperty.call(value, "intake_type");
  if (hasBenefitKey && hasIntakeType) return "UNKNOWN";
  if (hasIntakeType && ["IMMIGRATION", "AUTO_ACCIDENT", "DUI_CRIMINAL"].includes(String(value.intake_type))) return "LEGAL";
  if (hasBenefitKey) return "BENEFITS";
  if (!hasIntakeType && value.service_key === "HANDOFF") return "HANDOFF";
  return "UNKNOWN";
}

export type FlowSubmissionSummary = { title: string; lines: string[] };

export function describeFlowSubmission(raw: unknown): FlowSubmissionSummary | null {
  const kind = classifyFlowSubmission(raw);
  const value = (raw && typeof raw === "object" ? raw as Record<string, unknown> : {});
  if (kind === "BENEFITS") {
    const benefitKey = String(value.benefit_key ?? "");
    const lines = [
      `Nombre: ${String(value.full_name ?? "—")}`,
      `ZIP: ${String(value.postal_code ?? "—")}`,
      `Beneficio: ${BENEFIT_LABELS[benefitKey] ?? benefitKey}`,
    ];
    if (value.email) lines.push(`Email: ${String(value.email)}`);
    return { title: "Formulario completado: beneficio", lines };
  }
  if (kind === "LEGAL") {
    const intakeType = String(value.intake_type ?? "");
    const lines = [
      `Nombre: ${String(value.full_name ?? "—")}`,
      `Tipo: ${LEGAL_TOPIC_LABELS[intakeType] ?? intakeType}`,
    ];
    if (value.topic) lines.push(`Tema: ${String(value.topic)}`);
    if (value.postal_code) lines.push(`ZIP: ${String(value.postal_code)}`);
    if (value.accident_date) lines.push(`Fecha del accidente: ${String(value.accident_date)}`);
    if (value.description) lines.push(`Detalle: ${String(value.description)}`);
    return { title: "Formulario completado: consulta legal", lines };
  }
  if (kind === "HANDOFF") {
    return { title: "Formulario completado: hablar con el equipo", lines: [] };
  }
  return null;
}

// Real send-path composes outbound image messages with
// altText = `Beneficio ${benefit.displayName}` (or the literal fallback
// "Imagen del cupón" when no altText was set) and persists exactly that
// string as the message's text content — the schema has no image/URL
// column at all. Detecting that exact shape, rather than guessing from
// arbitrary text, is how we honestly flag "this row is an image whose URL
// was never persisted" without fabricating a preview.
export function looksLikeUnpersistedCouponImage(content: string | null | undefined): boolean {
  const value = (content ?? "").trim();
  if (!value) return false;
  return value === "Imagen del cupón" || value.startsWith("Beneficio ");
}
