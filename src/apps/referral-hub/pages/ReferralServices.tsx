import { ArrowLeft, ArrowDown, ArrowUp, GripVertical, Pencil, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import {
  availableServices,
  isShownFirst,
  moveService,
  orderServices,
  serviceDescription,
  serviceIcon,
  serviceTitle,
  type ReferralService,
} from "./serviceExperienceModel";

export default function ReferralServices() {
  const { resolvedOrgId } = useReferralOrganization();
  const [services, setServices] = useState<ReferralService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const load = async () => {
    if (!resolvedOrgId) return;
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from("service_configs")
      .select("id,nombre,menu_label,menu_orden,activo,tipo,intake_objectives,icono")
      .eq("organization_id", resolvedOrgId)
      .order("menu_orden");
    setServices(orderServices((data ?? []) as ReferralService[]));
    setError(queryError ? "No pudimos cargar tus servicios. Inténtalo de nuevo." : "");
    setLoading(false);
  };

  useEffect(() => { void load(); }, [resolvedOrgId]);

  const ordered = useMemo(() => orderServices(services), [services]);
  const promoted = availableServices(ordered).slice(0, 3);
  const moreServices = availableServices(ordered).slice(3);

  const updateAvailability = async (service: ReferralService) => {
    if (!resolvedOrgId) return;
    setSavingId(service.id);
    const { error: updateError } = await supabase.from("service_configs")
      .update({ activo: !service.activo })
      .eq("organization_id", resolvedOrgId).eq("id", service.id);
    if (updateError) setError("No pudimos guardar ese cambio. Inténtalo de nuevo.");
    else setServices((current) => current.map((item) => item.id === service.id ? { ...item, activo: !service.activo } : item));
    setSavingId(null);
  };

  const saveOrder = async (next: ReferralService[]) => {
    if (!resolvedOrgId) return;
    setServices(next);
    setSavingId("order");
    const results = await Promise.all(next.map((service) => supabase.from("service_configs")
      .update({ menu_orden: service.menu_orden }).eq("organization_id", resolvedOrgId).eq("id", service.id)));
    if (results.some(({ error: updateError }) => updateError)) {
      setError("No pudimos guardar el nuevo orden. Recargamos la lista para mantenerla al día.");
      await load();
    }
    setSavingId(null);
  };

  const reposition = (serviceId: string, destination: number) => void saveOrder(moveService(ordered, serviceId, destination));
  const toggleFront = (service: ReferralService) => {
    const active = availableServices(ordered);
    const activeIndex = active.findIndex(({ id }) => id === service.id);
    const nextFrontService = active[0];
    const firstServiceAfterFront = active[3];
    const destination = activeIndex >= 0 && activeIndex < 3
      ? (firstServiceAfterFront ? ordered.findIndex(({ id }) => id === firstServiceAfterFront.id) : ordered.length - 1)
      : (nextFrontService ? ordered.findIndex(({ id }) => id === nextFrontService.id) : 0);
    reposition(service.id, destination);
  };

  return (
    <main className="rh-services-page">
      <Link className="bolt-rh-back" to="/more"><ArrowLeft />Volver</Link>
      <header className="rh-services-header">
        <div><p className="rh-eyebrow">EXPERIENCIA DEL CLIENTE</p><h1>Servicios</h1><p>Organiza lo que tus clientes pueden encontrar y decide qué quieres mostrar primero.</p></div>
        <section className="rh-general-preview" aria-label="Vista previa del menú general">
          <span><Sparkles />Vista previa del menú</span>
          <strong>¿Qué necesitas hoy?</strong>
          {promoted.map((service) => <button key={service.id} type="button">{serviceIcon(service)} {serviceTitle(service)}</button>)}
          {moreServices.length ? <button type="button">Ver más servicios</button> : null}
        </section>
      </header>

      {error ? <div className="rh-service-alert" role="alert">{error}</div> : null}
      {loading ? <div className="rh-service-empty" role="status">Cargando servicios…</div> : ordered.length === 0 ? <div className="rh-service-empty">Aún no tienes servicios configurados.</div> : (
        <section className="rh-service-grid" aria-label="Servicios disponibles">
          {ordered.map((service, index) => {
            const shownFirst = isShownFirst(service, ordered);
            const disabled = savingId === service.id || savingId === "order";
            return <article key={service.id} className={`rh-service-card ${draggedId === service.id ? "is-dragging" : ""}`} draggable={!disabled}
              onDragStart={() => setDraggedId(service.id)} onDragEnd={() => setDraggedId(null)}
              onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedId && draggedId !== service.id) reposition(draggedId, index); setDraggedId(null); }}>
              <div className="rh-service-card-top">
                <span className="rh-service-icon" aria-hidden="true">{serviceIcon(service)}</span>
                <div><h2>{serviceTitle(service)}</h2><p>{serviceDescription(service)}</p></div>
                <span className="rh-drag-handle" aria-label={`Arrastrar ${serviceTitle(service)}`}><GripVertical /></span>
              </div>
              <div className="rh-service-controls">
                <button type="button" className={`rh-state-button ${service.activo ? "is-on" : ""}`} aria-pressed={service.activo === true} disabled={disabled} onClick={() => void updateAvailability(service)}>
                  <i />{service.activo ? "Disponible" : "No disponible"}
                </button>
                <button type="button" className={`rh-front-button ${shownFirst ? "is-on" : ""}`} aria-pressed={shownFirst} disabled={!service.activo || disabled} onClick={() => toggleFront(service)}>
                  <Sparkles />{shownFirst ? "Al frente" : "Mostrar al frente"}
                </button>
                <span className="rh-reorder-buttons" aria-label={`Cambiar orden de ${serviceTitle(service)}`}>
                  <button type="button" disabled={index === 0 || disabled} onClick={() => reposition(service.id, index - 1)}><ArrowUp /><span className="sr-only">Subir</span></button>
                  <button type="button" disabled={index === ordered.length - 1 || disabled} onClick={() => reposition(service.id, index + 1)}><ArrowDown /><span className="sr-only">Bajar</span></button>
                </span>
                <Link to={`/services/${encodeURIComponent(service.id)}`}><Pencil />Editar</Link>
              </div>
            </article>;
          })}
        </section>
      )}
    </main>
  );
}
