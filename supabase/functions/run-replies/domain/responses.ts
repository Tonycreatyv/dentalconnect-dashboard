import { IntentResult } from "./intents.ts";
import { Stage, getPlaybookEntry } from "./playbook.ts";

export type ResponsePayload = {
  replyText: string;
  stage: Stage;
  questionKey: string;
};

export type ResponseContext = Record<string, string>;

export function composeResponse(stage: Stage, intent: IntentResult, context: ResponseContext = {}): ResponsePayload {
  const entry = getPlaybookEntry(stage, intent.intent);
  return {
    replyText: fillTemplate(entry.template, context),
    stage: entry.nextStage,
    questionKey: entry.questionKey,
  };
}

function fillTemplate(template: string, context: ResponseContext) {
  return template.replace(/\{(\w+)\}/g, (_, key) => context[key] ?? "");
}
