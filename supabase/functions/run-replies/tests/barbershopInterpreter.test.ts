import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { interpretBarbershopTurn } from "../domain/barbershopInterpreter.ts";

const baseArgs = {
  timezone: "America/Tegucigalpa",
  clinicSettings: {},
  state: {},
  collected: {},
};

Deno.test("1) maje ocupo quedar nitido hoy tipo 5 con el que este libre", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "Maje ocupo quedar nítido hoy tipo 5 con el que esté libre",
  });
  assertEquals(r.intent, "booking_request");
  assertEquals(r.entities.service_name, "Cita barbería");
  assertEquals(r.entities.service_reference, "generic");
  assertEquals(r.entities.date_text, "hoy");
  assertEquals(r.entities.time_text, "5");
  assertEquals(r.entities.provider_preference, "any");
  assertEquals(r.tool_needed, "check_availability");
  assertEquals(r.next_step, "preconfirm_booking");
  assert(r.confidence >= 0.7);
});

Deno.test("2) cuanto me sale fresh con barba y corte", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "cuánto me sale quedar fresh con barba y corte",
  });
  assertEquals(r.intent, "pricing_request");
  assertEquals(r.entities.service_name, "Corte + barba");
  assertEquals(r.next_step, "answer_pricing");
});

Deno.test("3) hay chance ahorita", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "hay chance ahorita?",
  });
  assertEquals(r.intent, "availability_request");
  assertEquals(r.entities.date_text, "hoy");
  assertEquals(r.tool_needed, "check_availability");
});

Deno.test("4) agendame ese manana a las 4 usa previous info", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "agendame ese mañana a las 4",
    collected: { last_price_service: "Corte + barba" },
  });
  assertEquals(r.intent, "booking_request");
  assertEquals(r.entities.service_name, "Corte + barba");
  assertEquals(r.entities.service_reference, "previous_info");
  assertEquals(r.should_use_previous_info, true);
  assertEquals(r.entities.date_text, "manana");
  assertEquals(r.entities.time_text, "4");
  assertEquals(r.tool_needed, "check_availability");
});

Deno.test("5) quiero cita con Carlos manana a las 5 no reutiliza Barba", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "quiero cita con Carlos mañana a las 5",
    collected: { last_price_service: "Barba" },
  });
  assertEquals(r.intent, "booking_request");
  assertEquals(r.entities.service_name, "Cita barbería");
  assertEquals(r.entities.service_reference, "generic");
  assertEquals(r.should_use_previous_info, false);
  assertEquals(r.entities.preferred_barber, "Carlos");
  assertEquals(r.entities.provider_preference, "specific");
  assertEquals(r.entities.date_text, "manana");
  assertEquals(r.entities.time_text, "5");
  assertEquals(r.needs_tool, "check_availability");
});

Deno.test("6) que uso para que el pelo me dure todo el dia", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "qué uso para que el pelo me dure todo el día?",
  });
  assertEquals(r.intent, "product_request");
  assertEquals(r.entities.product_need, "fijación fuerte");
  assertEquals(r.tool_needed, "get_products");
});

Deno.test("7) me podes apuntar manana temprano con cualquiera", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "me podés apuntar mañana temprano con cualquiera?",
  });
  assertEquals(r.intent, "booking_request");
  assertEquals(r.entities.service_name, "Cita barbería");
  assertEquals(r.entities.date_text, "manana");
  assertEquals(r.entities.time_text, "temprano");
  assertEquals(r.entities.provider_preference, "any");
  assertEquals(r.tool_needed, "check_availability");
});

Deno.test("8) andan atendiendo por llegada o solo cita", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "andan atendiendo por llegada o solo cita?",
  });
  assert(["availability_request", "unknown"].includes(r.intent));
  assertEquals(r.tool_needed, "none");
  assert(r.user_facing_summary.toLowerCase().includes("llegada") || r.user_facing_summary.toLowerCase().includes("cita"));
});

Deno.test("9) se me hizo tarde, llego en 10", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "se me hizo tarde, llego en 10",
  });
  assert(["unknown", "reschedule_request"].includes(r.intent));
  assertEquals(r.tool_needed, "none");
  assert(r.user_facing_summary.toLowerCase().includes("tarde") || r.user_facing_summary.toLowerCase().includes("retraso"));
});

Deno.test("10) me cambias la cita para mas tarde", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "me cambiás la cita para más tarde?",
  });
  assertEquals(r.intent, "reschedule_request");
  assertEquals(r.entities.time_text, "más tarde");
  assertEquals(r.needs_tool, "reschedule_appointment");
});

Deno.test("LLM: parsea JSON valido y lo usa cuando confidence alta", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "texto cualquiera",
      llmClient: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: "pricing_question",
              confidence: 0.91,
              entities: { service_name: "Corte + barba" },
              should_use_previous_info: false,
              needs_tool: "get_service_price",
              user_facing_summary: "Consulta de precio",
            }),
          },
        }],
      }),
    });
    assertEquals(r.intent, "pricing_request");
    assert(["clarify", "answer_pricing"].includes(r.next_step));
    assertEquals(r.entities.service_name, "Corte + barba");
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
  }
});

Deno.test("LLM: fallback al stub cuando JSON invalido", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "quiero cita con Carlos mañana a las 5",
      llmClient: async () => ({
        choices: [{ message: { content: "{not-json" } }],
      }),
    });
    assertEquals(r.intent, "booking_request");
    assertEquals(r.entities.preferred_barber, "Carlos");
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
  }
});

Deno.test("LLM: si el interpreter falla, hace fallback sin crashear", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "quiero cita con Carlos mañana a las 5",
      llmClient: async () => {
        throw new Error("forced-interpreter-error");
      },
    });
    assertEquals(r.intent, "booking_request");
    assertEquals(r.entities.preferred_barber, "Carlos");
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
  }
});

Deno.test("LLM: fallback al stub cuando confidence baja", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "cuánto me sale corte y barba",
      llmClient: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: "pricing_question",
              confidence: 0.2,
              entities: { service_name: "Corte + barba" },
              should_use_previous_info: false,
              needs_tool: "get_service_price",
              user_facing_summary: "low confidence",
            }),
          },
        }],
      }),
    });
    assertEquals(r.intent, "pricing_request");
    assertEquals(r.entities.service_name, "Corte + barba");
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
  }
});

Deno.test("LLM: sanitiza intent invalido", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "que cita tngo?",
      llmClient: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: "hack_execute",
              confidence: 0.95,
              entities: {},
              should_use_previous_info: false,
              needs_tool: "none",
              user_facing_summary: "x",
            }),
          },
        }],
      }),
    });
    assertEquals(r.intent, "unknown");
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
  }
});

Deno.test("LLM: sanitiza needs_tool invalido y no ejecuta nada", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "hola",
      llmClient: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: "appointment_lookup",
              confidence: 0.9,
              entities: {},
              should_use_previous_info: false,
              needs_tool: "execute_now",
              tool_execution: { action: "book_appointment" },
              user_facing_summary: "x",
            }),
          },
        }],
      }),
    });
    assertEquals(r.intent, "appointment_lookup");
    assertEquals(r.needs_tool, "none");
    assertEquals(r.tool_needed, "none");
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
  }
});

Deno.test("LLM: entities desconocidas no rompen", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "texto",
      llmClient: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: "booking_request",
              confidence: 0.9,
              entities: {
                service_name: "Cita barbería",
                strange_key: "should_be_ignored",
              },
              should_use_previous_info: false,
              needs_tool: "check_availability",
              user_facing_summary: "x",
            }),
          },
        }],
      }),
    });
    assertEquals(r.intent, "booking_request");
    assertEquals(r.entities.service_name, "Cita barbería");
    assertEquals((r.entities as any).strange_key, undefined);
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
  }
});

Deno.test("LLM: si no hay API keys usa fallback stub", async () => {
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  const originalGroq = Deno.env.get("GROQ_API_KEY");
  Deno.env.delete("OPENAI_API_KEY");
  Deno.env.delete("GROQ_API_KEY");
  try {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "quiero cita con Carlos mañana a las 5",
    });
    assertEquals(r.intent, "booking_request");
    assertEquals(r.entities.preferred_barber, "Carlos");
  } finally {
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
    if (originalGroq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", originalGroq);
  }
});
