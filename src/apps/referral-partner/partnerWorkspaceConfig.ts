import { resolvePartnerWorkspaceConfig, type PartnerWorkspaceConfig, type ResolvedPartnerWorkspaceConfig } from "./workspaceConfig";

export type PartnerWorkspaceRule = { service_id: string; active: boolean; workspace_config: PartnerWorkspaceConfig | null };
export type PartnerWorkspaceService = { id: string; workspace_config: PartnerWorkspaceConfig | null };

export function resolvePartnerServiceWorkspace(
  serviceId: string,
  partnerConfig: PartnerWorkspaceConfig | null,
  rules: PartnerWorkspaceRule[],
  services: PartnerWorkspaceService[],
): ResolvedPartnerWorkspaceConfig {
  const rule = rules.find((item) => item.service_id === serviceId && item.active) ?? null;
  const service = services.find((item) => item.id === serviceId) ?? null;
  return resolvePartnerWorkspaceConfig(service?.workspace_config ?? {}, partnerConfig ?? {}, rule?.workspace_config ?? {});
}

export function partnerConfiguredServiceIds(rules: PartnerWorkspaceRule[]): Set<string> {
  return new Set(rules.filter((rule) => rule.active).map((rule) => rule.service_id));
}
