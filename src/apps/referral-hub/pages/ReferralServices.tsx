import { ArrowLeft, ChevronRight, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

type ServiceConfig = {
  id: string;
  nombre: string | null;
  menu_label: string | null;
  menu_orden: number | null;
  activo: boolean | null;
  tipo: string | null;
  intake_objectives: unknown;
};

function serviceDescription(service: ServiceConfig) {
  const type = String(service.tipo ?? "").toLowerCase();
  if (type === "static_action") return "Respuesta y acción automática";
  if (type === "transfer") return "Transferencia a representante";
  if (Array.isArray(service.intake_objectives) && service.intake_objectives.length > 0) {
    return "Recopila información antes de continuar";
  }
  return "Configuración del servicio.";
}

export default function ReferralServices() {
  const { resolvedOrgId } = useReferralOrganization();
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!resolvedOrgId) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void supabase
      .from("service_configs")
      .select("id,nombre,menu_label,menu_orden,activo,tipo,intake_objectives")
      .eq("organization_id", resolvedOrgId)
      .order("menu_orden")
      .then(({ data, error: queryError }) => {
        if (!active) return;
        setServices((data ?? []) as ServiceConfig[]);
        setError(queryError ? "No se pudo cargar el catálogo." : "");
        setLoading(false);
      });
    return () => { active = false; };
  }, [resolvedOrgId]);

  return (
    <main className="mx-auto w-full max-w-[880px] pb-4 sm:px-2">
      <Link className="bolt-rh-back" to="/more"><ArrowLeft />Volver</Link>
      <header className="mb-4 border-b border-white/[0.07] pb-4">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#F0F1F3]">
          Configuración de servicios
        </h1>
        <p className="mt-1 text-xs text-[#8B9098]">
          {loading
            ? "Cargando servicios…"
            : `${services.length} ${services.length === 1 ? "servicio configurado" : "servicios configurados"}`}
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-sm text-[#8B9098]" role="status">
          Cargando catálogo…
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-lg border border-[#26292E] bg-[#0E0F11] px-4 py-10 text-center">
          <strong className="block text-sm font-medium text-[#F0F1F3]">Sin servicios configurados</strong>
          <span className="mt-1 block text-xs text-[#8B9098]">Los servicios activos aparecerán aquí.</span>
        </div>
      ) : (
        <div className="divide-y divide-[#1C1F23] border-y border-[#26292E]" aria-label="Catálogo de servicios">
          {services.map((service) => (
            <Link key={service.id} to={`/services/${encodeURIComponent(service.id)}`} className="group flex min-h-16 items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:px-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#26292E] bg-[#16181C] text-[#8B9098]" aria-hidden="true">
                <Package className="h-4 w-4" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-sm font-medium text-[#F0F1F3]">
                  {service.menu_label || service.nombre || "Servicio sin nombre"}
                </h2>
                <p className="mt-1 break-words text-xs leading-5 text-[#8B9098]">
                  {serviceDescription(service)}
                </p>
              </div>
              <span className={service.activo
                ? "shrink-0 rounded-full bg-[#16291E] px-2.5 py-1 text-[11px] font-medium text-[#3FCF7E]"
                : "shrink-0 rounded-full bg-[#1E2126] px-2.5 py-1 text-[11px] font-medium text-[#8B9098]"}
              >
                {service.activo ? "Activo" : "Inactivo"}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#565C66] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
