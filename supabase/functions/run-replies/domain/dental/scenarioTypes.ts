export type ExpectedResult = {
  intent?: string;
  route?: string;
  mustInclude?: string[];
  mustExclude?: string[];
  nextExpected?: string;
};

export type ScenarioStep = {
  actor: "user" | "assistant" | "system";
  message: string;
  expected?: ExpectedResult;
};

export type ConversationScenario = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  initialState?: Record<string, unknown>;
  steps: ScenarioStep[];
};
