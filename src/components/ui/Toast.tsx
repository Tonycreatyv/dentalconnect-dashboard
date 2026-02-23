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
  success: "border-[#E5E7EB] bg-white text-slate-700",
  error: "border-[#E5E7EB] bg-white text-slate-700",
  info: "border-[#E5E7EB] bg-white text-slate-700",
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
      <div className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${KIND_STYLES[kind]}`}>
        {message}
      </div>
    </div>
  );
}
