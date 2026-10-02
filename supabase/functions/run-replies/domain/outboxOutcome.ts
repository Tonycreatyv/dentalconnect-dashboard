export function automationDisabledOutcome(
  channel: string,
  automationEnabled: boolean,
) {
  const reason = !automationEnabled ? "automation_disabled" : `${channel}_disabled`;
  return {
    updates: {
      status: "paused" as const,
      sent_at: null,
      last_error: reason,
    },
    result: {
      status: "paused" as const,
      sentAt: null,
      lastError: reason,
    },
  };
}
