import { cn } from "../lib/cn";

export function ChatBubble({
  content,
  meta,
  label,
  tone = "bot",
}: {
  content: string;
  meta?: React.ReactNode;
  label?: string;
  tone?: "user" | "staff" | "bot";
}) {
  return (
    <div
      className={cn(
        "chat-bubble-safe rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap",
        tone === "user" && "ml-auto rounded-br-md bg-[#C97738] text-[#160C06]",
        tone === "staff" && "mr-auto rounded-bl-md border border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
        tone === "bot" && "mr-auto rounded-bl-md bg-white/[0.09] text-white/90",
      )}
    >
      {label ? <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div> : null}
      <div className="text-safe">{content || "—"}</div>
      {meta ? <div className="mt-1.5 flex min-w-0 flex-wrap gap-2 text-[10px] opacity-65">{meta}</div> : null}
    </div>
  );
}
