import { Intent } from "./intents.ts";

export type InterpreterResult = {
  intent: Intent;
  summary: string;
  business_type_hint: string | null;
  buying_signal_level: "low" | "medium" | "high";
  selected_pain_hint: string | null;
  secondary_goals: string[];
  wants_full_automation: boolean;
  frustration_detected: boolean;
  confidence: number;
};

export function stubInterpreter(text: string): InterpreterResult {
  const lower = text.toLowerCase();
  if (
    lower.includes("queiro probar") ||
    lower.includes("quiero probar") ||
    lower.includes("probar el sistema")
  ) {
    return {
      intent: "trial_interest",
      summary: "test the system",
      business_type_hint: null,
      buying_signal_level: "high",
      selected_pain_hint: "more_appointments",
      secondary_goals: ["follow_up"],
      wants_full_automation: true,
      frustration_detected: false,
      confidence: 0.8,
    };
  }
  if (lower.includes("ya te lo dije") || lower.includes("ya dije")) {
    return {
      intent: "frustration_signal",
      summary: "already told us",
      business_type_hint: null,
      buying_signal_level: "low",
      selected_pain_hint: null,
      secondary_goals: [],
      wants_full_automation: false,
      frustration_detected: true,
      confidence: 0.8,
    };
  }
  if (lower.includes("automatizar") || lower.includes("automatización")) {
    return {
      intent: "pain_selection",
      summary: "automation focused",
      business_type_hint: "general",
      buying_signal_level: "medium",
      selected_pain_hint: "more_appointments",
      secondary_goals: ["organization", "follow_up", "faster_replies"],
      wants_full_automation: true,
      frustration_detected: false,
      confidence: 0.8,
    };
  }
  return {
    intent: "unknown",
    summary: "",
    business_type_hint: null,
    buying_signal_level: "low",
    selected_pain_hint: null,
    secondary_goals: [],
    wants_full_automation: false,
    frustration_detected: false,
    confidence: 0,
  };
}
