import {
  EMPTY_DENTAL_INTERPRETER_RESULT,
  type DentalInterpreterResult,
} from "./dentalInterpreterTypes.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("DENTAL_INTERPRETER_MODEL") ?? "gpt-4o-mini";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateResult(raw: unknown): DentalInterpreterResult | null {
  if (!isObject(raw)) return null;
  const intent = typeof raw.intent === "string" ? raw.intent : "unknown";
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  const safe = {
    ...EMPTY_DENTAL_INTERPRETER_RESULT,
    intent: intent as DentalInterpreterResult["intent"],
    clinical_category: (typeof raw.clinical_category === "string" ? raw.clinical_category : "unknown") as DentalInterpreterResult["clinical_category"],
    service_suggestion: typeof raw.service_suggestion === "string" ? raw.service_suggestion : null,
    urgency: (typeof raw.urgency === "string" ? raw.urgency : "routine") as DentalInterpreterResult["urgency"],
    symptoms: Array.isArray(raw.symptoms) ? raw.symptoms.filter((v): v is string => typeof v === "string") : [],
    patient_context: isObject(raw.patient_context) ? {
      is_for_someone_else: Boolean(raw.patient_context.is_for_someone_else),
      relation: typeof raw.patient_context.relation === "string" ? raw.patient_context.relation : null,
      patient_name: typeof raw.patient_context.patient_name === "string" ? raw.patient_context.patient_name : null,
    } : undefined,
    date: typeof raw.date === "string" ? raw.date : null,
    time: typeof raw.time === "string" ? raw.time : null,
    wants_same_as_before: Boolean(raw.wants_same_as_before),
    wants_additional_appointment: Boolean(raw.wants_additional_appointment),
    wants_to_change_existing: Boolean(raw.wants_to_change_existing),
    needs_human_attention: Boolean(raw.needs_human_attention),
    safe_reply_hint: typeof raw.safe_reply_hint === "string" ? raw.safe_reply_hint : null,
    missing_slots: Array.isArray(raw.missing_slots)
      ? raw.missing_slots.filter((v): v is "service" | "date" | "time" | "patient_name" | "confirmation" =>
        v === "service" || v === "date" || v === "time" || v === "patient_name" || v === "confirmation"
      )
      : [],
    confidence,
    source: "llm",
  } satisfies DentalInterpreterResult;
  return safe;
}

export async function interpretDentalMessageWithLLM(args: {
  text: string;
  timezone: string;
  currentDate: string;
  clinicServices: Array<{ name: string; active?: boolean; aliases?: string[] }>;
  recentState?: Record<string, unknown>;
}): Promise<DentalInterpreterResult> {
  if (!OPENAI_API_KEY) return { ...EMPTY_DENTAL_INTERPRETER_RESULT };

  const systemPrompt = `You are a dental front-desk interpreter.
Your job is to classify the patient message into structured JSON.
You do not diagnose.
You do not prescribe medicine.
You do not confirm appointments.
You do not invent prices, doctors, services, or availability.
Only infer the likely operational category and missing slots.

Return only valid JSON matching this schema:
{
  "intent": "...",
  "clinical_category": "...",
  "service_suggestion": "...",
  "urgency": "...",
  "symptoms": [],
  "patient_context": {
    "is_for_someone_else": false,
    "relation": null,
    "patient_name": null
  },
  "date": null,
  "time": null,
  "wants_same_as_before": false,
  "wants_additional_appointment": false,
  "wants_to_change_existing": false,
  "needs_human_attention": false,
  "safe_reply_hint": null,
  "missing_slots": [],
  "confidence": 0.0
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              text: args.text,
              timezone: args.timezone,
              currentDate: args.currentDate,
              clinicServices: args.clinicServices,
              recentState: args.recentState ?? {},
            }),
          },
        ],
      }),
    });

    const json = await response.json();
    const content = String(json?.choices?.[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(content);
    return validateResult(parsed) ?? { ...EMPTY_DENTAL_INTERPRETER_RESULT };
  } catch {
    return { ...EMPTY_DENTAL_INTERPRETER_RESULT };
  }
}
