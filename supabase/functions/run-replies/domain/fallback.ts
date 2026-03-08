import { Phase } from "./state.ts";

export function fallbackResponse(): { replyText: string; phase: Phase; questionKey: string } {
  return {
    replyText: "Si querés, te lo explico con un ejemplo para tu negocio.",
    phase: "solution",
    questionKey: "fallback",
  };
}
