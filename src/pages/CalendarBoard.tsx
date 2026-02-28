import { Component, type ReactNode } from "react";
import CalendarBoard from "../components/CalendarBoard";

type AgendaBoundaryState = {
  hasError: boolean;
};

class AgendaErrorBoundary extends Component<{ children: ReactNode }, AgendaBoundaryState> {
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
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 text-slate-800">
          <h2 className="text-lg font-semibold">No se pudo abrir la agenda</h2>
          <p className="mt-2 text-sm text-slate-600">
            Recargá la vista. Si el problema continúa, intentá nuevamente en unos minutos.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
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
  return (
    <AgendaErrorBoundary>
      <CalendarBoard />
    </AgendaErrorBoundary>
  );
}
