export type DentalClinicalCategory =
  | "dental_pain"
  | "gum_pain"
  | "swelling"
  | "bleeding"
  | "broken_tooth"
  | "cavity_or_decay"
  | "cleaning"
  | "orthodontics"
  | "whitening"
  | "extraction"
  | "implant"
  | "general_checkup"
  | "pricing"
  | "business_hours"
  | "location"
  | "appointment_lookup"
  | "reschedule"
  | "cancel"
  | "unknown";

export type DentalUrgency = "routine" | "soon" | "urgent" | "emergency";

export type DentalInterpreterIntent =
  | "greeting"
  | "book_appointment"
  | "ask_price"
  | "ask_availability"
  | "appointment_lookup"
  | "reschedule_appointment"
  | "cancel_appointment"
  | "ask_business_hours"
  | "ask_location"
  | "ask_service_info"
  | "human_handoff"
  | "unknown";

export type DentalInterpreterResult = {
  intent: DentalInterpreterIntent;
  clinical_category: DentalClinicalCategory;
  service_suggestion: string | null;
  urgency: DentalUrgency;
  symptoms: string[];
  patient_context?: {
    is_for_someone_else?: boolean;
    relation?: string | null;
    patient_name?: string | null;
  };
  date: string | null;
  time: string | null;
  wants_same_as_before?: boolean;
  wants_additional_appointment?: boolean;
  wants_to_change_existing?: boolean;
  needs_human_attention: boolean;
  safe_reply_hint: string | null;
  missing_slots: Array<"service" | "date" | "time" | "patient_name" | "confirmation">;
  confidence: number;
  source: "deterministic" | "llm" | "none";
};

export const EMPTY_DENTAL_INTERPRETER_RESULT: DentalInterpreterResult = {
  intent: "unknown",
  clinical_category: "unknown",
  service_suggestion: null,
  urgency: "routine",
  symptoms: [],
  date: null,
  time: null,
  needs_human_attention: false,
  safe_reply_hint: null,
  missing_slots: [],
  confidence: 0,
  source: "none",
};
