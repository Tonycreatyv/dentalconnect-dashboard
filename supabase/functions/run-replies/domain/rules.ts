import { Stage } from "./playbook.ts";
import { StageOrder } from "./state.ts";

export function shouldSkipRepeat(lastQuestion: string | undefined, currentQuestion: string, currentStage: Stage): boolean {
  if (!lastQuestion) return false;
  if (lastQuestion === currentQuestion) return true;
  return false;
}

export function shouldSkipDiscovery(collected: Record<string, unknown>, currentStage: Stage): boolean {
  if (!collected) return false;
  const selectedPain = String(collected.selected_pain ?? "").trim();
  if (selectedPain) return true;
  const currentIndex = StageOrder.indexOf(currentStage);
  const valueIndex = StageOrder.indexOf("VALUE");
  if (currentIndex >= valueIndex) return true;
  return false;
}

export function repeatFallback(): string {
  return "Si querés, te lo explico con un ejemplo basado en tu negocio para seguir avanzando.";
}
