import type { ToolHandler } from "./toolTypes.ts";

export const recordPatientPreferenceTool: ToolHandler = async (input) => ({
  ok: true,
  tool: "record_patient_preference",
  data: { preference: input.preference ?? null },
});

export const createFollowupTool: ToolHandler = async (input) => ({
  ok: true,
  tool: "create_followup",
  data: { followup: input },
});

export const requestHumanTakeoverTool: ToolHandler = async (input) => ({
  ok: true,
  tool: "request_human_takeover",
  data: { reason: input.reason ?? null },
});
