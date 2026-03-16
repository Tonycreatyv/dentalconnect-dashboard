const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4o-mini";

export interface ClassifiedIntent {
  intent: string;
  service: string | null;
  date: string | null;
  time: string | null;
  patient_name: string | null;
  is_confirmation: boolean;
  is_negation: boolean;
  is_greeting: boolean;
  urgency: "normal" | "urgent" | "emergency";
  raw_understanding: string;
}

function fallbackClassification(message: string): ClassifiedIntent {
  return {
    intent: "unknown",
    service: null,
    date: null,
    time: null,
    patient_name: null,
    is_confirmation: false,
    is_negation: false,
    is_greeting: /^(hola|buenas|hi|hello)/i.test(message.trim()),
    urgency: "normal",
    raw_understanding: message,
  };
}

export async function classifyMessage(args: {
  message: string;
  conversationHistory: string[];
  currentStage: string;
  nextExpected: string | null;
  collectedData: Record<string, unknown>;
  clinicServices: string[];
}): Promise<ClassifiedIntent> {
  if (!OPENAI_API_KEY) return fallbackClassification(args.message);
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const systemPrompt = `Eres un clasificador de intenciones para una clínica dental.
Tu trabajo es entender qué quiere el paciente y extraer datos estructurados.

FECHA DE HOY: ${today}
AÑO ACTUAL: ${currentYear}

REGLA CRÍTICA DE FECHAS:
- SIEMPRE usa el año ${currentYear} para las fechas
- NUNCA devuelvas fechas en el pasado
- Si el paciente dice "martes", busca el PRÓXIMO martes desde hoy (${today})
- Si el paciente dice "el 17", usa ${currentYear}-mes-17 (el más cercano en el futuro)
- "mañana" = el día después de ${today}

SERVICIOS DE LA CLÍNICA: ${args.clinicServices.join(", ")}

ESTADO ACTUAL DE LA CONVERSACIÓN:
- Etapa: ${args.currentStage}
- Esperando: ${args.nextExpected || "nada específico"}
- Datos recopilados: ${JSON.stringify(args.collectedData)}

REGLAS:
- Interpreta typos y errores ortográficos (imlpaante = implante, limpisa = limpieza)
- "si", "sí", "ok", "dale", "claro", "perfecto" después de una pregunta = confirmación
- "no", "cambiar", "otro" = negación
- Detecta urgencias: dolor fuerte, sangrado, hinchazón, accidente = urgente/emergencia
- Extrae fechas relativas: "mañana", "el lunes", "esta semana" (siempre en ${currentYear})
- Para "martes 17": busca el próximo martes 17 desde ${today}
- Extrae horas: "a las 3", "3pm", "15:00", "por la mañana" (mañana=9:00, tarde=14:00)
- Si el paciente da su nombre, extráelo

RESPONDE SOLO CON JSON VÁLIDO, sin markdown ni backticks:
{
  "intent": "book_appointment|ask_services|ask_prices|ask_hours|ask_location|greeting|provide_name|provide_service|provide_datetime|confirm|deny|reschedule|cancel|emergency|general_question|farewell|unknown",
  "service": "nombre del servicio detectado o null",
  "date": "YYYY-MM-DD o null",
  "time": "HH:MM o null",
  "patient_name": "nombre detectado o null",
  "is_confirmation": true,
  "is_negation": false,
  "is_greeting": false,
  "urgency": "normal",
  "raw_understanding": "resumen en 1 línea"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: "system", content: systemPrompt },
          ...args.conversationHistory.slice(-6).map((msg, index) => ({
            role: index % 2 === 0 ? "user" as const : "assistant" as const,
            content: msg,
          })),
          { role: "user", content: args.message },
        ],
      }),
    });

    const data = await response.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      intent: String(parsed.intent ?? "unknown"),
      service: parsed.service ?? null,
      date: parsed.date ?? null,
      time: parsed.time ?? null,
      patient_name: parsed.patient_name ?? null,
      is_confirmation: Boolean(parsed.is_confirmation),
      is_negation: Boolean(parsed.is_negation),
      is_greeting: Boolean(parsed.is_greeting),
      urgency: parsed.urgency === "emergency" || parsed.urgency === "urgent" ? parsed.urgency : "normal",
      raw_understanding: String(parsed.raw_understanding ?? ""),
    };
  } catch (err) {
    console.error("[llmClassifier] failed:", err);
    return fallbackClassification(args.message);
  }
}
