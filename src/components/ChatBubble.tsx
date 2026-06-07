import { cn } from "../lib/cn";

export function ChatBubble({
  content,
  meta,
  label,
  options,
  tone = "bot",
}: {
  content: string;
  meta?: React.ReactNode;
  label?: string;
  options?: string[];
  tone?: "user" | "staff" | "bot";
}) {
  return (
    <div
      className={cn(
        "chat-bubble-safe rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap",
        tone === "user" && "ml-auto rounded-br-md bg-[#25D366] text-[#03140A]",
        tone === "staff" && "mr-auto rounded-bl-md border border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
        tone === "bot" && "mr-auto rounded-bl-md bg-white/[0.09] text-white/90",
      )}
    >
      {label ? <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div> : null}
      <div className="text-safe">{content || "—"}</div>
      {options?.length ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-[#F7F5EF] shadow-[0_8px_18px_rgba(0,0,0,0.18)]">
          {options.map((option, index) => (
            <div
              key={`${option}-${index}`}
              className="flex min-h-10 items-center justify-center border-b border-[#DAD7CD] px-3 text-center text-sm font-semibold text-[#14443A] last:border-b-0"
            >
              {option}
            </div>
          ))}
        </div>
      ) : null}
      {meta ? <div className="mt-1.5 flex min-w-0 flex-wrap gap-2 text-[10px] opacity-65">{meta}</div> : null}
    </div>
  );
}
