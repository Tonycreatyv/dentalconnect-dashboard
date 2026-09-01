import { AlertTriangle, ImageOff, QrCode, Store, Users, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import SegmentedControl from "../ui/SegmentedControl";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge from "../ui/StatusBadge";
import { DESTINATION_LABELS, useQrCampaigns, type CampaignDestination } from "../operations/useQrCampaigns";
import { useServices } from "../operations/useServices";
import { useBusinesses } from "../operations/useBusinesses";

function NewCampaignDrawer({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, destination: CampaignDestination) => Promise<{ ok: boolean; message?: string }> }) {
  const [destination, setDestination] = useState<CampaignDestination>("luis_benefit_medical");
  const [name, setName] = useState(DESTINATION_LABELS.luis_benefit_medical);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function onDestinationChange(next: CampaignDestination) {
    setDestination(next);
    if (!name.trim() || Object.values(DESTINATION_LABELS).includes(name)) setName(DESTINATION_LABELS[next]);
  }

  async function submit() {
    setSaving(true);
    setError("");
    const result = await onCreate(name, destination);
    setSaving(false);
    if (result.ok) onClose(); else setError(result.message || "No se pudo crear la campaña.");
  }

  return (
    <>
      <button type="button" className="hub-drawer-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="hub-drawer" role="dialog" aria-label="Nueva campaña">
        <div className="hub-drawer-header">
          <h2>Nueva campaña</h2>
          <button type="button" className="hub-drawer-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="hub-drawer-body">
          <div className="hub-field">
            <label htmlFor="new-campaign-name">Nombre de la campaña</label>
            <input id="new-campaign-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Flyer consultorio Dr. Pérez" />
          </div>
          <div className="hub-field">
            <label htmlFor="new-campaign-destination">Destino</label>
            <select id="new-campaign-destination" value={destination} onChange={(event) => onDestinationChange(event.target.value as CampaignDestination)}>
              {(Object.keys(DESTINATION_LABELS) as CampaignDestination[])
                .filter((key) => key === "menu" || key.startsWith("luis_benefit_"))
                .map((key) => <option key={key} value={key}>{DESTINATION_LABELS[key]}</option>)}
            </select>
          </div>
          <div className="hub-field">
            <label>Imagen del cupón</label>
            <div className="hub-upload-zone is-disabled"><p>Este destino usa la imagen ya configurada para el beneficio.</p></div>
          </div>
          {error ? <div className="hub-blocked-note"><AlertTriangle size={14} />{error}</div> : null}
        </div>
        <div className="hub-drawer-footer">
          <button type="button" className="hub-primary" disabled={saving || !name.trim()} onClick={() => void submit()}>
            {saving ? "Creando…" : "Crear campaña"}
          </button>
        </div>
      </div>
    </>
  );
}

function CampanasSegment() {
  const { campaigns, loading, error, createCampaign } = useQrCampaigns();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="hub-section-head" style={{ marginBottom: ".6rem" }}>
        <span className="hub-page-count">{campaigns.length} {campaigns.length === 1 ? "campaña" : "campañas"}</span>
        <button type="button" className="hub-chip-btn is-primary" onClick={() => setCreating(true)}>Nueva campaña</button>
      </div>
      {loading ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar las campañas" description={error} />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={QrCode} title="No hay campañas todavía" description="Creá una campaña para generar un QR y enlace de WhatsApp." />
      ) : (
        <div className="hub-campaign-grid">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} to={`/campanas/campana/${campaign.id}`} className="hub-campaign-card">
              {campaign.imageUrl ? <img className="hub-campaign-image" src={campaign.imageUrl} alt={campaign.attributionLabel || ""} /> : <div className="hub-campaign-image-placeholder"><ImageOff size={20} /></div>}
              <div className="hub-campaign-body">
                <div className="hub-campaign-body-head">
                  <strong>{campaign.attributionLabel || DESTINATION_LABELS[campaign.destination]}</strong>
                  <StatusBadge tone={campaign.active ? "success" : "neutral"} label={campaign.active ? "Activa" : "Pausada"} />
                </div>
                <p className="hub-campaign-meta">{DESTINATION_LABELS[campaign.destination]}{campaign.businessLabel ? ` · ${campaign.businessLabel}` : ""}</p>
                <p className="hub-campaign-meta">{campaign.requestsCount} {campaign.requestsCount === 1 ? "pedido" : "pedidos"}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating ? (
        <NewCampaignDrawer
          onClose={() => setCreating(false)}
          onCreate={(name, destination) => createCampaign({ name, destination })}
        />
      ) : null}
    </div>
  );
}

function ServiciosSegment() {
  const { services, loading, error } = useServices();
  return (
    <div>
      {loading ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los servicios" description={error} />
      ) : (
        <div className="hub-campaign-grid">
          {services.map((service) => (
            <Link key={service.id} to={`/campanas/servicio/${service.id}`} className="hub-campaign-card">
              {service.imageUrl ? <img className="hub-campaign-image" src={service.imageUrl} alt={service.label} /> : <div className="hub-campaign-image-placeholder"><Users size={20} /></div>}
              <div className="hub-campaign-body">
                <strong>{service.label}</strong>
                {service.businesses.length ? <p className="hub-campaign-meta">{service.businesses.slice(0, 2).join(", ")}{service.businesses.length > 2 ? ` +${service.businesses.length - 2}` : ""}</p> : null}
                <p className="hub-campaign-meta">{service.requestCount} {service.requestCount === 1 ? "solicitud" : "solicitudes"} · {service.campaignCount} {service.campaignCount === 1 ? "campaña" : "campañas"}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NegociosSegment() {
  const { businesses, loading, error } = useBusinesses();
  return (
    <div>
      {loading ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los negocios" description={error} />
      ) : businesses.length === 0 ? (
        <EmptyState icon={Store} title="No hay negocios registrados" />
      ) : (
        <div className="hub-campaign-grid">
          {businesses.map((business) => (
            <Link key={business.id} to={`/campanas/negocio/${encodeURIComponent(business.id)}`} className="hub-campaign-card">
              {business.imageUrl ? <img className="hub-campaign-image" src={business.imageUrl} alt={business.name} /> : <div className="hub-campaign-image-placeholder"><Store size={20} /></div>}
              <div className="hub-campaign-body">
                <strong>{business.name}</strong>
                <p className="hub-campaign-meta">{business.serviceLabel}</p>
                <p className="hub-campaign-meta">{business.requestCount} {business.requestCount === 1 ? "pedido" : "pedidos"}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CampaignsHub() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as "campanas" | "servicios" | "negocios") || "campanas";

  function setView(next: string) {
    setParams(next === "campanas" ? {} : { view: next });
  }

  return (
    <div className="hub-page">
      <PageHeader eyebrow="Campañas" title="Campañas" />
      <SegmentedControl
        segments={[
          { id: "campanas", label: "Campañas" },
          { id: "servicios", label: "Servicios" },
          { id: "negocios", label: "Negocios" },
        ]}
        activeId={view}
        onChange={setView}
      />
      {view === "servicios" ? <ServiciosSegment /> : view === "negocios" ? <NegociosSegment /> : <CampanasSegment />}
    </div>
  );
}
