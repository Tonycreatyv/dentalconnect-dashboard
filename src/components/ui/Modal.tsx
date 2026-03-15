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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-6 text-white shadow-none backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-white">{title}</div>
            {description ? <div className="text-sm text-white/60">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
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
