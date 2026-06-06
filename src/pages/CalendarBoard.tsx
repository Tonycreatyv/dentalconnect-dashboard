import { Component, type ReactNode } from "react";
import CalendarBoard from "../components/CalendarBoard";
import Appointments from "./Appointments";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";

type AgendaBoundaryState = {
  hasError: boolean;
};

class AgendaErrorBoundary extends Component<{ children: ReactNode; agendaTitle: string }, AgendaBoundaryState> {
  state: AgendaBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) {
      console.error("[AgendaErrorBoundary]", error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/80">
          <h2 className="text-lg font-semibold">No se pudo abrir la agenda</h2>
          <p className="mt-2 text-sm text-white/60">
            Recargá la vista. Si el problema continúa, intentá nuevamente en unos minutos.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-2xl bg-[#3CBDB9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#35a9a5]"
          >
            Recargar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function CalendarBoardPage() {
  const { resolvedBusinessType } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);
  if (resolvedBusinessType === "barbershop") return <Appointments />;
  return (
    <AgendaErrorBoundary agendaTitle={vertical.agendaTitle}>
      <CalendarBoard />
    </AgendaErrorBoundary>
  );
}
