import { Intent } from "./intents.ts";

export type Stage =
  | "DISCOVERY"
  | "PAIN"
  | "IMPACT"
  | "VALUE"
  | "SOLUTION"
  | "DEMO"
  | "TRIAL_OFFER"
  | "ACTIVATION"
  | "CONVERSION";

export type PlaybookEntry = {
  template: string;
  nextStage: Stage;
  questionKey: string;
};

const DEFAULT_ENTRIES: Record<Stage, PlaybookEntry> = {
  DISCOVERY: {
    template: "Hola, te ayudo a responder {verticalFocus} y convertir consultas en clientes.",
    nextStage: "PAIN",
    questionKey: "discovery_intro",
  },
  PAIN: {
    template: "Muchos {verticalName} pierden {pain}. ¿Quién responde los mensajes en tu negocio ahora mismo?",
    nextStage: "IMPACT",
    questionKey: "pain_question",
  },
  IMPACT: {
    template: "Perfecto. Entonces el enfoque es {offer} para evitar que los interesados se enfríen.",
    nextStage: "SOLUTION",
    questionKey: "impact_statement",
  },
  VALUE: {
    template:
      "Si lo que buscas es generar más dinero, lo primero suele ser {recommendation}.\n\n{reason}\n\n{mapping}\n\n{close}",
    nextStage: "VALUE",
    questionKey: "value_recommendation",
  },
  SOLUTION: {
    template:
      "Entiendo. El sistema puede sostener la atención inicial y coordinar mensajes sin depender de respuestas manuales.",
    nextStage: "DEMO",
    questionKey: "solution_statement",
  },
  DEMO: {
    template: "Si querés puedo mostrarte un ejemplo de cómo lo usamos para {verticalFocus}.",
    nextStage: "TRIAL_OFFER",
    questionKey: "demo_offer",
  },
  TRIAL_OFFER: {
    template: "Te puedo dejar iniciar una prueba para {trialFrame}.",
    nextStage: "ACTIVATION",
    questionKey: "trial_offer",
  },
  ACTIVATION: {
    template:
      "Si querés, te explico cómo se aplica en tu negocio y qué parte conviene automatizar primero.",
    nextStage: "CONVERSION",
    questionKey: "activation_next",
  },
  CONVERSION: {
    template: "Listo, te acompaño en la activación y el seguimiento para que no se enfríen los clientes.",
    nextStage: "CONVERSION",
    questionKey: "conversion_close",
  },
};

const STAGE_OVERRIDES: Partial<Record<Stage, Partial<Record<Intent, PlaybookEntry>>>> = {
  PAIN: {
    selected_pain: {
      template: "Perfecto. Muchos negocios pierden clientes porque no responden rápido. ¿Quién responde los mensajes hoy?",
      nextStage: "IMPACT",
      questionKey: "pain_selected",
    },
  },
  SOLUTION: {
    demo_interest: {
      template: "Si querés puedo mostrarte un ejemplo de cómo funciona ese flujo justo ahora.",
      nextStage: "DEMO",
      questionKey: "solution_demo",
    },
  },
  ACTIVATION: {
    acceptance: {
      template:
        "Perfecto.\n\nVamos a activarlo para tu {verticalFocus}.\n\nPrimero, ¿querés enfocarlo en {recommendation} o también en seguimiento?",
      nextStage: "ACTIVATION",
      questionKey: "activation_acceptance",
    },
    activation_interest: {
      template:
        "Perfecto.\n\nVamos a activarlo para tu {verticalFocus}.\n\n¿Cómo querés arrancar: con {recommendation} o con seguimiento?",
      nextStage: "ACTIVATION",
      questionKey: "activation_interest",
    },
    onboarding_interest: {
      template:
        "Perfecto.\n\nVamos a activarlo para tu {verticalFocus}.\n\n¿Cómo querés arrancar: con {recommendation} o con seguimiento?",
      nextStage: "ACTIVATION",
      questionKey: "activation_interest",
    },
  },
};

const FALLBACK_ENTRY: PlaybookEntry = DEFAULT_ENTRIES["DISCOVERY"];

export function getPlaybookEntry(stage: Stage, intent: Intent): PlaybookEntry {
  const overrides = STAGE_OVERRIDES[stage]?.[intent];
  if (overrides) return overrides;
  return DEFAULT_ENTRIES[stage] ?? FALLBACK_ENTRY;
}
