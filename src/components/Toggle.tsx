import { cn } from "../lib/cn";

export function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative inline-flex h-8 w-14 items-center rounded-full border transition",
        enabled
          ? "border-[#3CBDB9]/70 bg-black/45"
          : "border-white/15 bg-black/35"
      )}
    >
      <span
        className={cn(
          "inline-block h-6 w-6 transform rounded-full transition shadow-[0_2px_8px_rgba(0,0,0,0.35)]",
          enabled ? "bg-[#59E0B8]" : "bg-white/90",
          enabled ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
