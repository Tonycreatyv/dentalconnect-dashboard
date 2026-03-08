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

export const StageOrder: Stage[] = [
  "DISCOVERY",
  "PAIN",
  "IMPACT",
  "VALUE",
  "SOLUTION",
  "DEMO",
  "TRIAL_OFFER",
  "ACTIVATION",
  "CONVERSION",
];

export function getNextStage(current: Stage, intent: string): Stage {
  if (
    intent === "selected_pain" ||
    intent === "more_appointments" ||
    intent === "faster_replies" ||
    intent === "organization" ||
    intent === "follow_up"
  ) {
    return "VALUE";
  }
  if (
    intent === "book_appointment" ||
    intent === "services" ||
    intent === "pricing_interest" ||
    intent === "pricing"
  ) {
    return "SOLUTION";
  }
  if (intent === "demo_interest") return "DEMO";
  if (intent === "trial_interest") return "TRIAL_OFFER";
  if (intent === "onboarding_interest" && current === "TRIAL_OFFER") return "ACTIVATION";
  if (intent === "human_handoff" && current === "SOLUTION") return "DEMO";
  if (intent === "pricing" && current === "SOLUTION") return "CONVERSION";
  return current;
}

export function enforceMonotonicStage(current: Stage, next: Stage): Stage {
  const currentIdx = StageOrder.indexOf(current);
  const nextIdx = StageOrder.indexOf(next);
  if (nextIdx < currentIdx) return current;
  return next;
}
