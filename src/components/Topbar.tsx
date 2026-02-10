import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useClinic } from "../context/ClinicContext";

export const Topbar = () => {
  const { signOut } = useAuth();
  const { clinic } = useClinic();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/75 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.22em] uppercase text-white/55">
            DentalConnect
          </p>
          <p className="truncate text-sm font-semibold text-white">
            {clinic?.name ?? "Clinic Demo"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate("/login", { replace: true });
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/80 hover:text-white hover:bg-white/[0.06] transition"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
};
