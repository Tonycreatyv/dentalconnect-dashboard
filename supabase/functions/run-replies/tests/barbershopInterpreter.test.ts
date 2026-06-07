import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  getBarbershopInterpreterRuntimeStatus,
  interpretBarbershopSemanticFallback,
  interpretBarbershopTurn,
} from "../domain/barbershopInterpreter.ts";
import {
  buildBarbershopAvailabilityButtons,
  buildExpandedBarbershopTimeSlotsList,
  formatBarbershopAvailabilityListBody,
} from "../domain/barbershopResponseComposer.ts";

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
  assert(
    r.user_facing_summary.toLowerCase().includes("llegada") ||
      r.user_facing_summary.toLowerCase().includes("cita"),
  );
});

Deno.test("9) se me hizo tarde, llego en 10", async () => {
  const r = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "se me hizo tarde, llego en 10",
  });
  assert(["unknown", "reschedule_request"].includes(r.intent));
  assertEquals(r.tool_needed, "none");
  assert(
    r.user_facing_summary.toLowerCase().includes("tarde") ||
      r.user_facing_summary.toLowerCase().includes("retraso"),
  );
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

Deno.test("LLM runtime status: GROQ preferred when LLM_PROVIDER=groq and GROQ key exists", () => {
  const originalProvider = Deno.env.get("LLM_PROVIDER");
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  const originalGroq = Deno.env.get("GROQ_API_KEY");
  try {
    Deno.env.set("LLM_PROVIDER", "groq");
    Deno.env.set("GROQ_API_KEY", "groq-test");
    Deno.env.set("OPENAI_API_KEY", "openai-test");
    const status = getBarbershopInterpreterRuntimeStatus();
    assertEquals(status.provider, "groq");
    assertEquals(status.llm_available, true);
  } finally {
    if (originalProvider === undefined) Deno.env.delete("LLM_PROVIDER");
    else Deno.env.set("LLM_PROVIDER", originalProvider);
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
    if (originalGroq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", originalGroq);
  }
});

Deno.test("LLM runtime status: OpenAI selected when GROQ missing and OpenAI present", () => {
  const originalProvider = Deno.env.get("LLM_PROVIDER");
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  const originalGroq = Deno.env.get("GROQ_API_KEY");
  try {
    Deno.env.delete("LLM_PROVIDER");
    Deno.env.delete("GROQ_API_KEY");
    Deno.env.set("OPENAI_API_KEY", "openai-test");
    const status = getBarbershopInterpreterRuntimeStatus();
    assertEquals(status.provider, "openai");
    assertEquals(status.llm_available, true);
  } finally {
    if (originalProvider === undefined) Deno.env.delete("LLM_PROVIDER");
    else Deno.env.set("LLM_PROVIDER", originalProvider);
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
    if (originalGroq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", originalGroq);
  }
});

Deno.test("LLM runtime status: none when no keys", () => {
  const originalProvider = Deno.env.get("LLM_PROVIDER");
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  const originalGroq = Deno.env.get("GROQ_API_KEY");
  try {
    Deno.env.delete("LLM_PROVIDER");
    Deno.env.delete("GROQ_API_KEY");
    Deno.env.delete("OPENAI_API_KEY");
    const status = getBarbershopInterpreterRuntimeStatus();
    assertEquals(status.provider, "none");
    assertEquals(status.llm_available, false);
  } finally {
    if (originalProvider === undefined) Deno.env.delete("LLM_PROVIDER");
    else Deno.env.set("LLM_PROVIDER", originalProvider);
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
    if (originalGroq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", originalGroq);
  }
});

Deno.test("LLM interpreter runs with Groq key even when OpenAI key is missing", async () => {
  const originalProvider = Deno.env.get("LLM_PROVIDER");
  const originalOpenAi = Deno.env.get("OPENAI_API_KEY");
  const originalGroq = Deno.env.get("GROQ_API_KEY");
  try {
    Deno.env.set("LLM_PROVIDER", "groq");
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.set("GROQ_API_KEY", "groq-test");
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText: "texto ambiguo",
      llmClient: async (args) => {
        assertEquals(args.provider, "groq");
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                intent: "pricing_question",
                confidence: 0.9,
                entities: { service_name: "Corte + barba" },
                should_use_previous_info: false,
                needs_tool: "get_service_price",
                user_facing_summary: "Precio",
              }),
            },
          }],
        };
      },
    });
    assertEquals(r.intent, "pricing_request");
    assertEquals(r.entities.service_name, "Corte + barba");
  } finally {
    if (originalProvider === undefined) Deno.env.delete("LLM_PROVIDER");
    else Deno.env.set("LLM_PROVIDER", originalProvider);
    if (originalOpenAi === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalOpenAi);
    if (originalGroq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", originalGroq);
  }
});

Deno.test("Intent category: availability_discovery variants map consistently", async () => {
  const variants = [
    "que dia estas disponible",
    "cual esta disponible",
    "cuando tenes cupo",
    "hay chance esta semana",
    "para cuando hay",
    "que horarios tienen",
    "que dia puedo llegar",
  ];
  for (const inboundText of variants) {
    const r = await interpretBarbershopTurn({
      ...baseArgs,
      inboundText,
    });
    assertEquals(
      r.intent,
      "availability_request",
      `variant failed: ${inboundText}`,
    );
  }
});

Deno.test("Intent category: booking_request variants keep booking intent with entities when present", async () => {
  const withDateTime = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "quiero corte mañana a las 10",
  });
  assertEquals(withDateTime.intent, "booking_request");
  assertEquals(withDateTime.entities.service_name, "Corte clásico");
  assertEquals(withDateTime.entities.date_text, "manana");
  assertEquals(withDateTime.entities.time_text, "10");

  const withServiceOnly = await interpretBarbershopTurn({
    ...baseArgs,
    inboundText: "quiero corte mañana",
  });
  assertEquals(withServiceOnly.intent, "booking_request");
  assertEquals(withServiceOnly.entities.service_name, "Corte clásico");
  assertEquals(withServiceOnly.entities.date_text, "manana");
});

Deno.test("Semantic fallback maps cancel typo cncelar to cancel_appointment", () => {
  const r = interpretBarbershopSemanticFallback({
    ...baseArgs,
    inboundText: "quiero cncelar la cita",
  });
  assertEquals(r.intent, "cancel_appointment");
  assert(r.confidence >= 0.75);
  assertEquals(r.normalized_user_message.includes("cancelar"), true);
});

Deno.test("Semantic fallback maps cancel typo canselar to cancel_appointment", () => {
  const r = interpretBarbershopSemanticFallback({
    ...baseArgs,
    inboundText: "quiero canselar mi cita",
  });
  assertEquals(r.intent, "cancel_appointment");
  assert(r.confidence >= 0.75);
});

Deno.test("Semantic fallback maps natural move request to reschedule_appointment", () => {
  const r = interpretBarbershopSemanticFallback({
    ...baseArgs,
    inboundText: "me la podes mover para mañana a la 1",
  });
  assertEquals(r.intent, "reschedule_appointment");
  assertEquals(r.entities.date_text, "manana");
  assertEquals(r.entities.time_text, "1");
});

Deno.test("Semantic fallback maps active booking time-block correction to availability", () => {
  const r = interpretBarbershopSemanticFallback({
    ...baseArgs,
    inboundText: "y si mejor en la tarde",
    state: { nextExpected: "select_time" },
    collected: {
      activeBookingFlow: true,
      current_service_key: "corte_clasico",
      current_date: "2026-05-23",
    },
  });
  assertEquals(r.intent, "availability_question");
  assertEquals(r.entities.time_block, "afternoon");
});

Deno.test("Semantic fallback maps mixed greeting availability to booking/availability", () => {
  const r = interpretBarbershopSemanticFallback({
    ...baseArgs,
    inboundText: "hola tenes disponible a las 2 mañana para corte",
  });
  assert(["availability_question", "booking_request"].includes(r.intent));
  assertEquals(r.entities.service_name, "Corte clásico");
  assertEquals(r.entities.date_text, "manana");
  assertEquals(r.entities.time_text, "2");
});

Deno.test("Semantic fallback keeps unsupported low confidence", () => {
  const r = interpretBarbershopSemanticFallback({
    ...baseArgs,
    inboundText: "quien gano el partido de ayer",
  });
  assertEquals(r.intent, "unknown");
  assert(r.confidence < 0.75);
});

Deno.test("Semantic fallback maps cancelalal typo to cancel_appointment", () => {
  const r = interpretBarbershopSemanticFallback({
    ...baseArgs,
    inboundText: "cancelalal",
  });
  assertEquals(r.intent, "cancel_appointment");
  assert(r.confidence >= 0.75);
});

Deno.test("BarberLine availability with more than 3 slots uses list instead of time buttons", () => {
  const buttons = buildBarbershopAvailabilityButtons([
    { date: "2026-06-08", time: "09:00", provider_id: "allan" },
    { date: "2026-06-08", time: "09:30", provider_id: "edgar" },
    { date: "2026-06-08", time: "10:00", provider_id: "juan" },
    { date: "2026-06-08", time: "10:30", provider_id: "allan" },
  ], true);

  assertEquals(buttons, []);
});

Deno.test("BarberLine availability with 3 or fewer slots uses all time buttons", () => {
  const buttons = buildBarbershopAvailabilityButtons([
    { date: "2026-06-08", time: "09:00", provider_id: "allan" },
    { date: "2026-06-08", time: "09:30", provider_id: "edgar" },
    { date: "2026-06-08", time: "10:00", provider_id: "juan" },
  ], false);

  assertEquals(buttons.map((button) => button.title), [
    "9:00 AM",
    "9:30 AM",
    "10:00 AM",
  ]);
  assertEquals(buttons.some((button) => button.title === "Más horas"), false);
});

Deno.test("BarberLine availability list builds morning and afternoon WhatsApp sections", () => {
  const list = buildExpandedBarbershopTimeSlotsList({
    slots: [
      {
        date: "2026-06-08",
        time: "10:00",
        provider_id: "juan",
        provider_name: "Juan",
      },
      {
        date: "2026-06-08",
        time: "10:30",
        provider_id: "allan",
        provider_name: "Allan",
      },
      {
        date: "2026-06-08",
        time: "13:00",
        provider_id: "juan",
        provider_name: "Juan",
      },
      {
        date: "2026-06-08",
        time: "14:00",
        provider_id: "allan",
        provider_name: "Allan",
      },
    ],
    serviceName: "Corte clásico",
    providerPreference: "any",
  });

  assert(list);
  assertEquals(list.title, "Horarios disponibles");
  assertEquals(list.buttonText, "Ver horarios disponibles");
  assert(!list.body.includes("Más horas"));
  assertEquals(list.sections.map((section) => section.title), [
    "Mañana",
    "Tarde",
  ]);
  assertEquals(list.sections[0].rows.map((row) => row.title), [
    "10:00 AM · Juan",
    "10:30 AM · Allan",
  ]);
  assertEquals(list.sections[1].rows.map((row) => row.title), [
    "1:00 PM · Juan",
    "2:00 PM · Allan",
  ]);
});

Deno.test("BarberLine availability list body groups visible slots by morning and afternoon", () => {
  const body = formatBarbershopAvailabilityListBody([
    { time: "09:00", provider_name: "Allan" },
    { time: "09:30", provider_name: "Edgar" },
    { time: "10:00", provider_name: "Juan" },
    { time: "13:00", provider_name: "Allan" },
    { time: "14:00", provider_name: "Edgar" },
    { time: "15:00", provider_name: "Juan" },
  ]);

  assert(body.includes("Estos son algunos horarios disponibles 💈"));
  assert(body.includes("Mañana:"));
  assert(body.includes("• 9:00 AM · Allan"));
  assert(body.includes("Tarde:"));
  assert(body.includes("• 3:00 PM · Juan"));
  assert(body.includes("Escogé una hora para continuar."));
  assertEquals(body.includes("Más horas"), false);
});

Deno.test("BarberLine expanded time selection keeps date time and barber in select_slot payload", () => {
  const list = buildExpandedBarbershopTimeSlotsList({
    slots: [
      {
        date: "2026-06-08",
        time: "14:00",
        provider_id: "allan",
        provider_name: "Allan",
      },
    ],
    body: "Escogé una hora de la lista.",
    serviceName: "Corte clásico",
    providerPreference: "any",
  });

  assert(list);
  const selectedRow = list.sections[0].rows[0];
  assertEquals(selectedRow.id, "select_slot:2026-06-08|14:00|allan");
  assertEquals(selectedRow.title, "2:00 PM · Allan");
  assertEquals(selectedRow.description, "Corte clásico");
});
