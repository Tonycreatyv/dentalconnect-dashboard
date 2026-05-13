import type { ToolHandler } from "./toolTypes.ts";

export const listServicesTool: ToolHandler = async (input) => ({
  ok: true,
  tool: "list_services",
  data: { services: input.services ?? [] },
});

export const getServicePriceTool: ToolHandler = async (input) => ({
  ok: true,
  tool: "get_service_price",
  data: { service: input.service ?? null },
});

export const getBusinessHoursTool: ToolHandler = async (input) => ({
  ok: true,
  tool: "get_business_hours",
  data: { hours: input.hours ?? null },
});

export const getLocationTool: ToolHandler = async (input) => ({
  ok: true,
  tool: "get_location",
  data: { location: input.location ?? null },
});
