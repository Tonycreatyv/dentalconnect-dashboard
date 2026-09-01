import { AlertTriangle, ArrowLeft, Copy, Download, ImageOff, MapPin, Store, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import EmptyState from "../ui/EmptyState";
import StatCard from "../ui/StatCard";
import StatusBadge from "../ui/StatusBadge";
import { downloadQr, QrPreview } from "../ui/QrPreview";
import { referralQrPublicUrl } from "../operations/qrUrls";
import { DESTINATION_LABELS, useQrCampaigns } from "../operations/useQrCampaigns";
import { useServices } from "../operations/useServices";
import { useBusinesses } from "../operations/useBusinesses";

export function CampaignDetailScreen() {
  const { campaignId = "" } = useParams();
  const { campaigns, loading, error, setActive, renameCampaign } = useQrCampaigns();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const campaign = campaigns.find((item) => item.id === campaignId);

  if (loading) return <div className="hub-page"><Link className="hub-back" to="/campanas"><ArrowLeft />Volver</Link><EmptyState icon={Users} title="Cargando campaña…" /></div>;
  if (error || !campaign) return <div className="hub-page"><Link className="hub-back" to="/campanas"><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="Campaña no encontrada" description={error} /></div>;

  const url = referralQrPublicUrl(campaign.publicCode);

  return (
    <div className="hub-page">
      <Link className="hub-back" to="/campanas"><ArrowLeft />Volver</Link>
      <div className="hub-detail-hero">
        {campaign.imageUrl ? <img src={campaign.imageUrl} alt={campaign.attributionLabel || ""} /> : <div className="hub-detail-hero-placeholder"><ImageOff size={24} /></div>}
      </div>
      <div className="hub-detail-badge-row">
        <StatusBadge tone="neutral" label={DESTINATION_LABELS[campaign.destination]} />
        <StatusBadge tone={campaign.active ? "success" : "neutral"} label={campaign.active ? "Activa" : "Pausada"} />
      </div>
      {editing ? (
        <div className="hub-field" style={{ marginBottom: ".5rem" }}>
          <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
          <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem" }}>
            <button type="button" className="hub-primary" disabled={saving || !draftName.trim()} onClick={async () => { setSaving(true); await renameCampaign(campaign.id, draftName); setSaving(false); setEditing(false); }}>{saving ? "Guardando…" : "Guardar"}</button>
            <button type="button" className="hub-secondary" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <h1 className="hub-detail-title">{campaign.attributionLabel || DESTINATION_LABELS[campaign.destination]}</h1>
      )}
      {campaign.businessLabel ? <p className="hub-detail-sub">{campaign.businessLabel}</p> : null}

      <div className="hub-stat-grid">
        <StatCard label="Pedidos" value={campaign.requestsCount} />
        <StatCard label="Entradas (escaneos)" value={campaign.entriesCount} />
      </div>

      <div className="hub-detail-qr-row">
        <QrPreview value={url} />
        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", flex: 1 }}>
          <button type="button" className="hub-chip-btn" onClick={() => { void navigator.clipboard.writeText(url); }}><Copy size={12} style={{ marginRight: 4 }} />Copiar enlace</button>
          <button type="button" className="hub-chip-btn" onClick={() => downloadQr(campaign.publicCode, url)}><Download size={12} style={{ marginRight: 4 }} />Descargar QR</button>
        </div>
      </div>

      <div className="hub-campaign-actions" style={{ borderTop: "none", paddingTop: 0 }}>
        {!editing ? <button type="button" className="hub-chip-btn is-primary" onClick={() => { setDraftName(campaign.attributionLabel || DESTINATION_LABELS[campaign.destination]); setEditing(true); }}>Editar</button> : null}
        <button type="button" className="hub-chip-btn" onClick={() => void setActive(campaign.id, !campaign.active)}>{campaign.active ? "Pausar" : "Activar"}</button>
        <Link className="hub-chip-btn" to={`/clientes${campaign.campaignKey ? `?campaign=${encodeURIComponent(campaign.campaignKey)}` : ""}`}>Ver clientes</Link>
      </div>
    </div>
  );
}

export function ServiceDetailScreen() {
  const { serviceId = "" } = useParams();
  const { services, loading, error } = useServices();
  const { campaigns } = useQrCampaigns();
  const service = services.find((item) => item.id === serviceId);
  const relatedCampaigns = campaigns.filter((item) => item.destination === serviceId);

  if (loading) return <div className="hub-page"><Link className="hub-back" to="/campanas?view=servicios"><ArrowLeft />Volver</Link><EmptyState icon={Users} title="Cargando servicio…" /></div>;
  if (error || !service) return <div className="hub-page"><Link className="hub-back" to="/campanas?view=servicios"><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="Servicio no encontrado" description={error} /></div>;

  return (
    <div className="hub-page">
      <Link className="hub-back" to="/campanas?view=servicios"><ArrowLeft />Volver</Link>
      <div className="hub-detail-hero">
        {service.imageUrl ? <img src={service.imageUrl} alt={service.label} /> : <div className="hub-detail-hero-placeholder"><Users size={24} /></div>}
      </div>
      <h1 className="hub-detail-title">{service.label}</h1>
      {service.businesses.length ? <p className="hub-detail-sub">{service.businesses.join(", ")}</p> : null}

      <div className="hub-stat-grid">
        <StatCard label="Solicitudes" value={service.requestCount} />
        <StatCard label="Campañas" value={service.campaignCount} />
      </div>

      <section className="hub-section">
        <h2>Campañas asociadas</h2>
        {relatedCampaigns.length === 0 ? (
          <EmptyState icon={Store} title="Sin campañas asociadas" />
        ) : (
          <div className="hub-list">
            {relatedCampaigns.map((item) => (
              <Link key={item.id} className="hub-list-row" to={`/campanas/campana/${item.id}`}>
                <div><strong>{item.attributionLabel || DESTINATION_LABELS[item.destination]}</strong><small>{item.requestsCount} pedidos</small></div>
                <StatusBadge tone={item.active ? "success" : "neutral"} label={item.active ? "Activa" : "Pausada"} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <Link className="hub-primary" style={{ marginTop: "1rem", display: "inline-flex" }} to={`/clientes?service=${encodeURIComponent(service.id)}`}>Ver clientes</Link>
    </div>
  );
}

export function BusinessDetailScreen() {
  const { businessId = "" } = useParams();
  const { businesses, loading, error } = useBusinesses();
  const business = businesses.find((item) => item.id === decodeURIComponent(businessId));

  if (loading) return <div className="hub-page"><Link className="hub-back" to="/campanas?view=negocios"><ArrowLeft />Volver</Link><EmptyState icon={Store} title="Cargando negocio…" /></div>;
  if (error || !business) return <div className="hub-page"><Link className="hub-back" to="/campanas?view=negocios"><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="Negocio no encontrado" description={error} /></div>;

  return (
    <div className="hub-page">
      <Link className="hub-back" to="/campanas?view=negocios"><ArrowLeft />Volver</Link>
      <div className="hub-detail-hero">
        {business.imageUrl ? <img src={business.imageUrl} alt={business.name} /> : <div className="hub-detail-hero-placeholder"><Store size={24} /></div>}
      </div>
      <h1 className="hub-detail-title">{business.name}</h1>
      <p className="hub-detail-sub">{business.serviceLabel}</p>

      <div className="hub-stat-grid">
        <StatCard label="Pedidos" value={business.requestCount} />
      </div>

      {(business.address || business.postalCode) ? (
        <dl className="hub-facts">
          {business.address ? <div><dt>Dirección</dt><dd>{business.address}</dd></div> : null}
          {business.postalCode ? <div><dt>ZIP de cobertura</dt><dd>{business.postalCode}</dd></div> : null}
        </dl>
      ) : null}

      {business.campaignKey ? (
        <Link className="hub-primary" style={{ marginTop: "1rem", display: "inline-flex" }} to={`/clientes?campaign=${encodeURIComponent(business.campaignKey)}`}><MapPin size={16} style={{ marginRight: 6 }} />Ver clientes</Link>
      ) : null}
    </div>
  );
}
