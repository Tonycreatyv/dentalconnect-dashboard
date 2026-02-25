import { cn } from "../lib/cn";

export function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative inline-flex h-8 w-14 items-center rounded-full border transition",
        enabled
          ? "border-[#3CBDB9] bg-gradient-to-r from-[#0894C1] to-[#59E0B8]"
          : "border-white/15 bg-white/10"
      )}
    >
      <span
        className={cn(
          "inline-block h-6 w-6 transform rounded-full bg-white transition",
          enabled ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
