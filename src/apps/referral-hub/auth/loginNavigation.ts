export function resolveLoginReturnPath(state: unknown) {
  if (!state || typeof state !== "object") return "/";
  const from = (state as { from?: unknown }).from;
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return "/";
  return from;
}
