import { cn } from "../lib/cn";

export function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative inline-flex h-8 w-14 items-center rounded-full border transition",
        enabled ? "border-blue-600 bg-blue-600" : "border-[#E5E7EB] bg-[#F4F5F7]"
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
