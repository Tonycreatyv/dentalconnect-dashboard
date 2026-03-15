import { useEffect } from "react";

export type ToastKind = "success" | "error" | "info";

type Props = {
  open: boolean;
  kind?: ToastKind;
  message: string;
  onClose: () => void;
  durationMs?: number;
};

const KIND_STYLES: Record<ToastKind, string> = {
  success: "border-emerald-400/20 bg-emerald-500/10 text-emerald-400",
  error: "border-rose-400/20 bg-rose-500/10 text-rose-400",
  info: "border-blue-400/20 bg-blue-500/10 text-blue-400",
};

export function Toast({ open, kind = "info", message, onClose, durationMs = 2800 }: Props) {
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => onClose(), durationMs);
    return () => clearTimeout(id);
  }, [open, durationMs, onClose]);

  if (!open) return null;

  return (
    <div className="fixed right-4 top-4 z-[60] w-[min(92vw,360px)]">
      <div className={`rounded-2xl border px-4 py-3 text-sm shadow-none backdrop-blur-xl ${KIND_STYLES[kind]}`}>
        {message}
      </div>
    </div>
  );
}
