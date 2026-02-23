import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
};

export function Modal({ open, title, description, onClose, children, actions }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-xl rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            {description ? <div className="text-sm text-slate-700">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-slate-700 hover:bg-[#F4F5F7]"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5">{children}</div>

        {actions ? <div className="mt-6 flex items-center justify-end gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
