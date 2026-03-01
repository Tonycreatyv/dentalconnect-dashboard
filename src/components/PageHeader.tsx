import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  backTo?: string;
  showBackOnMobile?: boolean;
};

export default function PageHeader({ title, subtitle, action, backTo, showBackOnMobile = false }: Props) {
  const navigate = useNavigate();

  function onBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(backTo ?? "/overview");
  }

  return (
    <div className="sticky top-0 z-30 -mx-1 mb-4 rounded-2xl border border-white/10 bg-black/35 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-3 backdrop-blur-xl sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {showBackOnMobile ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-11 items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white/90 hover:bg-white/15 md:hidden"
              >
                <ChevronLeft className="h-4 w-4" />
                Volver
              </button>
            ) : null}
            <h1 className="truncate text-xl font-semibold text-white/95">{title}</h1>
          </div>
          {subtitle ? <p className="mt-1 text-sm text-white/72">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
