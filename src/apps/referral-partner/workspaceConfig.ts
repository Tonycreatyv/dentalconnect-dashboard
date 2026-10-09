export const PARTNER_WORKSPACE_ACTIONS = [
  "accept",
  "reject",
  "contacted",
  "no_answer",
  "appointment_scheduled",
  "converted",
  "closed_not_converted",
  "note",
  "follow_up",
  "correct_result",
  "call",
  "whatsapp",
] as const;

export type PartnerWorkspaceAction = typeof PARTNER_WORKSPACE_ACTIONS[number];

export type PartnerWorkspaceConfig = {
  display_name?: string;
  visible_columns?: string[];
  column_order?: string[];
  default_filters?: Record<string, unknown>;
  allowed_actions?: PartnerWorkspaceAction[];
  service_fields?: string[];
  export_enabled?: boolean;
  [futureKey: string]: unknown;
};

export type ResolvedPartnerWorkspaceConfig = Required<Pick<PartnerWorkspaceConfig,
  "visible_columns" | "column_order" | "default_filters" | "allowed_actions" | "service_fields" | "export_enabled"
>> & Pick<PartnerWorkspaceConfig, "display_name">;

const commonColumns = ["customer", "phone", "service", "received", "status", "next_follow_up", "result"];

export const PARTNER_WORKSPACE_SAFE_DEFAULTS: ResolvedPartnerWorkspaceConfig = {
  visible_columns: commonColumns,
  column_order: commonColumns,
  default_filters: {},
  allowed_actions: [...PARTNER_WORKSPACE_ACTIONS],
  service_fields: [],
  export_enabled: true,
};

const isAction = (value: string): value is PartnerWorkspaceAction =>
  (PARTNER_WORKSPACE_ACTIONS as readonly string[]).includes(value);

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0) && new Set(value).size === value.length;

/** Validates the stable keys while deliberately permitting future config keys. */
export const isPartnerWorkspaceConfig = (value: unknown): value is PartnerWorkspaceConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  if ("display_name" in config && (typeof config.display_name !== "string" || !config.display_name.trim() || config.display_name.length > 160)) return false;
  for (const key of ["visible_columns", "column_order", "service_fields"] as const) {
    if (key in config && !stringArray(config[key])) return false;
  }
  if ("default_filters" in config && (!config.default_filters || typeof config.default_filters !== "object" || Array.isArray(config.default_filters))) return false;
  if ("export_enabled" in config && typeof config.export_enabled !== "boolean") return false;
  return !("allowed_actions" in config) || (stringArray(config.allowed_actions) && config.allowed_actions.every(isAction));
};

const mergeWorkspaceConfig = (
  current: ResolvedPartnerWorkspaceConfig,
  override: PartnerWorkspaceConfig | null | undefined,
): ResolvedPartnerWorkspaceConfig => {
  if (!override) return current;
  if (!isPartnerWorkspaceConfig(override)) throw new Error("invalid_workspace_config");
  const allowed_actions = override.allowed_actions
    ? current.allowed_actions.filter((action) => override.allowed_actions?.includes(action))
    : current.allowed_actions;
  return {
    ...current,
    ...override,
    default_filters: { ...current.default_filters, ...override.default_filters },
    allowed_actions,
  };
};

/**
 * Mirrors the database resolver for future Admin/Portal readers. It is not
 * consumed by the live Partner Portal in this schema-only rollout.
 */
export const resolvePartnerWorkspaceConfig = (
  serviceConfig?: PartnerWorkspaceConfig | null,
  partnerConfig?: PartnerWorkspaceConfig | null,
  partnerServiceConfig?: PartnerWorkspaceConfig | null,
): ResolvedPartnerWorkspaceConfig =>
  [serviceConfig, partnerConfig, partnerServiceConfig].reduce(mergeWorkspaceConfig, PARTNER_WORKSPACE_SAFE_DEFAULTS);

/** Mirrors the future routing-window predicate without changing routing yet. */
export const isPartnerServiceRuleEligible = (
  rule: { active: boolean; starts_at?: string | null; expires_at?: string | null },
  now = new Date(),
): boolean => {
  if (!rule.active) return false;
  const startsAt = rule.starts_at ? new Date(rule.starts_at) : null;
  const expiresAt = rule.expires_at ? new Date(rule.expires_at) : null;
  return (!startsAt || startsAt <= now) && (!expiresAt || expiresAt > now);
};
