import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden dc-bg text-white">
      <div className="pointer-events-none absolute inset-0 dc-bg-overlay" />
      <div className="app-shell relative">{children}</div>
    </div>
  );
}
