import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { detectIntent } from "../domain/intents.ts";
import { Stage, enforceMonotonicStage } from "../domain/state.ts";
import { mergeLeadState } from "../index.ts";
import { runConversationEngine } from "../conversationEngine.ts";

const TEST_KNOWLEDGE = {
  pricing_plans: [
    { name: "Starter", price: 99, description: "Automatiza respuestas" },
    { name: "Growth", price: 249, description: "Agenda + follow-up", recommended: true },
    { name: "Pro", price: 499, description: "Plataforma completa" },
  ],
  implementation_steps: [
    "Crea tu cuenta",
    "Elige tu tipo de negocio",
    "Entra al dashboard",
    "Conecta Facebook o tu canal principal",
    "Activa el asistente",
    "Configura flujos y calendario",
    "Comienza a responder mensajes automáticamente",
  ],
  trial_flow: [
    "Signup con Creatyv",
    "Onboarding guiado",
    "Conecta canales y calendario",
    "Activa el asistente"
  ],
  dashboard_modules: ["Inbox", "Calendar", "Patients", "Automation", "Analytics", "Settings"],
  integrations: ["Facebook Messenger", "WhatsApp", "Instagram", "Web chat", "Google Calendar"],
};

function withKnowledge(args: Parameters<typeof runConversationEngine>[0]) {
  return runConversationEngine({ ...args, knowledge: TEST_KNOWLEDGE });
}

const CLINIC_KNOWLEDGE = {
  services: { title: "Servicios", items: ["Limpieza", "Ortodoncia"] },
  pricing: { title: "Precios", plans: [{ name: "Consulta", price: "$50", detail: "Incluye diagnóstico" }] },
  hours: { title: "Horarios", schedule: { "Lunes": "8-18", "Sáb": "9-13" } },
  location: { title: "Ubicación", address: "Av. Siempre Viva 742" },
  insurance: { title: "Seguros", covers: ["OSDE", "Swiss Medical"] },
};

function withClinic(args: Parameters<typeof runConversationEngine>[0]) {
  return runConversationEngine({ ...args, clinicKnowledge: CLINIC_KNOWLEDGE, knowledge: TEST_KNOWLEDGE });
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
Deno.test("intent detection finds greeting", () => {
  const intent = detectIntent("hola");
  assertEquals(intent.intent, "greeting");
});

Deno.test("stage enforcement prevents regression", () => {
  const result = enforceMonotonicStage("IMPACT", "DISCOVERY");
  assertEquals(result, "IMPACT");
});

Deno.test("pricing_request answers from knowledge", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "precio",
    leadState: { stage: "DISCOVERY" as Stage },
  });
  assertEquals(result?.statePatch.stage, "DISCOVERY");
  assertStringIncludes(result?.replyText ?? "", "Planes disponibles");
});

Deno.test("implementation_request answers from knowledge", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "cómo se implementa",
    leadState: { stage: "DISCOVERY" as Stage },
  });
  assertStringIncludes(result?.replyText ?? "", "Así se implementa");
});

Deno.test("trial interest overrides to activation", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "quiero probarlo",
    leadState: { stage: "DISCOVERY" as Stage },
  });
  assertEquals(result?.statePatch.stage, "ACTIVATION");
  assertStringIncludes(result?.replyText ?? "", "Vamos a activarlo");
});

Deno.test("combined implementation and pricing reply preserves order", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "primero dime la implementación y después dame precios",
    leadState: { stage: "DISCOVERY" as Stage },
  });
  const text = result?.replyText ?? "";
  assertStringIncludes(text, "Así se implementa");
  assertStringIncludes(text, "Planes disponibles");
  assertEquals(text.indexOf("Así se implementa"), 0);
});

Deno.test("real estate business_type is detected and persisted", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "bienes y raices",
    leadState: { stage: "DISCOVERY" as Stage, collected: {} },
  });
  assertEquals(result?.statePatch.collected?.business_type, "real_estate");
  assert(!((result?.replyText ?? "").includes("qué tipo de negocio")), "Should not re-ask business type");
});

Deno.test("venta de casas also resolves real estate without repeating question", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "venta de casas",
    leadState: { stage: "DISCOVERY" as Stage, collected: {} },
  });
  assertEquals(result?.statePatch.collected?.business_type, "real_estate");
  assert(!((result?.replyText ?? "").includes("qué tipo de negocio")));
});

Deno.test("automation summary responds to atender preguntas", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "atender preguntas",
    leadState: { stage: "DISCOVERY" as Stage, collected: { selected_pain: "more_appointments" } },
  });
  const text = result?.replyText ?? "";
  assertStringIncludes(text.toLowerCase(), "automatizar");
});

Deno.test("repeated business_type input skips the question", () => {
  const first = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "bienes y raices",
    leadState: { stage: "DISCOVERY" as Stage, collected: {} },
  });
  const mergedState = mergeLeadState({ collected: {} }, first?.statePatch ?? {});
  const second = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "bienes y raices",
    leadState: mergedState,
  });
  assert(!((second?.replyText ?? "").includes("qué tipo de negocio")));
});

Deno.test("clinic services question uses clinic knowledge", () => {
  const result = withClinic({
    organizationId: "creatyv-product",
    inboundText: "servicios",
    leadState: { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} },
  });
  assertStringIncludes(result?.replyText ?? "", "Servicios");
});

Deno.test("clinic pricing question returns plan info", () => {
  const result = withClinic({
    organizationId: "creatyv-product",
    inboundText: "precios",
    leadState: { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} },
  });
  assertStringIncludes(result?.replyText ?? "", "Plan");
});

Deno.test("clinic hours question answers schedule", () => {
  const result = withClinic({
    organizationId: "creatyv-product",
    inboundText: "horario",
    leadState: { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} },
  });
  assertStringIncludes(result?.replyText ?? "", "Lunes");
});

Deno.test("clinic location question answers address", () => {
  const result = withClinic({
    organizationId: "creatyv-product",
    inboundText: "ubicación",
    leadState: { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} },
  });
  assertStringIncludes(result?.replyText ?? "", "Av. Siempre Viva");
});

Deno.test("clinic insurance question answers coverage", () => {
  const result = withClinic({
    organizationId: "creatyv-product",
    inboundText: "seguro",
    leadState: { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} },
  });
  assertStringIncludes(result?.replyText ?? "", "OSDE");
});

Deno.test("clinic missing topic fallback", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "seguros",
    leadState: { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} },
    knowledge: TEST_KNOWLEDGE,
    clinicKnowledge: {},
  });
  assertStringIncludes(result?.replyText ?? "", "Lo siento");
});

Deno.test("clinic booking flow asks for date", () => {
  const result = withClinic({
    organizationId: "creatyv-product",
    inboundText: "hola quiero una cita",
    leadState: { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} },
  });
  assertStringIncludes(result?.replyText ?? "", "día");
  assertEquals(result?.statePatch?.collected?.booking?.last_question_key, "booking_day_question");
});

Deno.test("clinic booking flow asks for time after date", () => {
  const baseState = { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} };
  const first = withClinic({
    organizationId: "creatyv-product",
    inboundText: "hola quiero una cita",
    leadState: baseState,
  });
  const afterFirst = mergeLeadState(baseState, first?.statePatch ?? {});
  const second = withClinic({
    organizationId: "creatyv-product",
    inboundText: "mañana",
    leadState: { ...afterFirst, mode: "dental_clinic" },
  });
  assertStringIncludes(second?.replyText ?? "", "hora");
  assert(second?.statePatch?.collected?.booking?.preferred_date, "should record date");
});

Deno.test("clinic booking flow confirms appointment", () => {
  const baseState = { stage: "DISCOVERY" as Stage, mode: "dental_clinic", collected: {} };
  const first = withClinic({
    organizationId: "creatyv-product",
    inboundText: "hola quiero una cita",
    leadState: baseState,
  });
  const afterFirst = mergeLeadState(baseState, first?.statePatch ?? {});
  const second = withClinic({
    organizationId: "creatyv-product",
    inboundText: "mañana",
    leadState: { ...afterFirst, mode: "dental_clinic" },
  });
  const afterSecond = mergeLeadState({ ...baseState, mode: "dental_clinic" }, second?.statePatch ?? {});
  const third = withClinic({
    organizationId: "creatyv-product",
    inboundText: "a las 10",
    leadState: { ...afterSecond, mode: "dental_clinic" },
  });
  assertEquals(third?.toolAction?.name, "book_appointment");
  assertStringIncludes(third?.replyText ?? "", "Confirmamos tu cita");
  assertEquals(third?.statePatch?.collected?.booking?.preferred_time, "10:00");
});

Deno.test("stub interpreter handles typo-heavy trial phrase", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "queiro probar el sistema",
    leadState: { stage: "DISCOVERY" as Stage },
  });
  assertStringIncludes(String(result?.statePatch?.last_user_summary ?? ""), "test the system");
});

Deno.test("stub interpreter detects frustration", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "ya te lo dije",
    leadState: { stage: "DISCOVERY" as Stage },
  });
  assertStringIncludes(String(result?.statePatch?.last_user_summary ?? ""), "already told us");
});

Deno.test("stub interpreter infers automation priority", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "quiero automatizar todo pero me interesa mas conseguir mas citas",
    leadState: { stage: "DISCOVERY" as Stage },
  });
  assertStringIncludes(String(result?.statePatch?.last_user_summary ?? ""), "automation focused");
});

Deno.test("ambiguous continue advances discovery intro", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "si",
    leadState: {
      stage: "DISCOVERY" as Stage,
      collected: { next_expected: "DISCOVERY:discovery_intro" },
    },
  });
  assertStringIncludes(result?.replyText ?? "", "Perfecto, ¿querés que te cuente un ejemplo");
  assertEquals(result?.statePatch.collected?.next_expected, "DISCOVERY:discovery_followup");
});

Deno.test("ambiguous continue advances value recommendation", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "si",
    leadState: {
      stage: "VALUE" as Stage,
      collected: { next_expected: "VALUE:value_recommendation" },
    },
  });
  assertStringIncludes(result?.replyText ?? "", "Genial");
  assertEquals(result?.statePatch.collected?.next_expected, "VALUE:value_next");
});

Deno.test("ambiguous continue clarifies on value recommendation", () => {
  const result = withKnowledge({
    organizationId: "creatyv-product",
    inboundText: "ok",
    leadState: {
      stage: "VALUE" as Stage,
      collected: { next_expected: "VALUE:value_recommendation" },
    },
  });
  assertStringIncludes(result?.replyText ?? "", "Te escucho");
  assertEquals(result?.statePatch.collected?.next_expected, "VALUE:value_reclarify");
});

Deno.test("mergeLeadState merges booking fields", () => {
  const base = { collected: { booking: { preferred_date: "mañana", note: "foo" } } };
  const patch = { collected: { booking: { preferred_time: "10:00" } } };
  const merged = mergeLeadState(base, patch);
  assertEquals(merged.collected?.booking, {
    preferred_date: "mañana",
    note: "foo",
    preferred_time: "10:00",
  });
});
