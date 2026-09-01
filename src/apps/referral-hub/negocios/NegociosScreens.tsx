import { AlertTriangle, Building2, ChevronRight, Plus, Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import SegmentedControl from "../ui/SegmentedControl";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge from "../ui/StatusBadge";
import { SERVICE_LABELS, type LuisServiceId } from "../operations/luisCatalog";
import DemoBadge from "./DemoBadge";
import { getActiveNegociosDataSource } from "./dataSource";
import { loadRealServiceRows, type RealServiceRow } from "./realDataSource";
import { resolveBusinessImageUrl } from "./businessImage";
import { activeLocationThumbnails, extraLocationCount, isSupermarketCampaignKey, supermarketAvailabilityLabel } from "./supermarketCoupon";
import NewBusinessDrawer from "./NewBusinessDrawer";
import type { Business, Campaign, Coupon, SupermarketLocation } from "./types";

const dataSource = getActiveNegociosDataSource();

const VIEWS = [
  { id: "negocios", label: "Negocios" },
  { id: "servicios", label: "Servicios" },
  { id: "cupones", label: "Cupones" },
  { id: "campanas", label: "Campañas" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

export default function NegociosHub() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as ViewId) || "negocios";
  return (
    <div className="hub-page">
      <PageHeader eyebrow="Negocios" title="Negocios" meta={dataSource.mode === "demo" ? <DemoBadge /> : null} />
      <SegmentedControl segments={[...VIEWS]} activeId={view} onChange={(id) => setParams(id === "negocios" ? {} : { view: id })} />
      {view === "negocios" ? <NegociosSegment /> : null}
      {view === "servicios" ? <ServiciosSegment /> : null}
      {view === "cupones" ? <CuponesSegment /> : null}
      {view === "campanas" ? <CampanasSegment /> : null}
    </div>
  );
}

function useBusinessesList() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    dataSource.listBusinesses()
      .then((rows) => { setBusinesses(rows); setError(""); })
      .catch((reason) => setError(String((reason as Error)?.message || reason)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  return { businesses, loading, error, reload: load };
}

function useCouponsList() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dataSource.listCoupons().then(setCoupons).finally(() => setLoading(false));
  }, []);
  return { coupons, loading };
}

// Real, active locations behind each shared supermarket coupon campaign —
// keyed by campaignKey so a card never shows another campaign's locations.
function useSupermarketLocationsByCampaignKey(campaignKeys: string[]) {
  const [byKey, setByKey] = useState<Map<string, SupermarketLocation[]>>(new Map());
  const key = campaignKeys.join(",");
  useEffect(() => {
    if (!key) { setByKey(new Map()); return; }
    let active = true;
    Promise.all(key.split(",").map((campaignKey) =>
      dataSource.listSupermarketLocations(campaignKey).then((locations) => [campaignKey, locations] as const)))
      .then((entries) => { if (active) setByKey(new Map(entries)); });
    return () => { active = false; };
  }, [key]);
  return byKey;
}

function BusinessCard({ business, coupons }: { business: Business; coupons: Coupon[] }) {
  const image = resolveBusinessImageUrl(business, coupons);
  return (
    <Link className="hub-negocio-card" to={`/negocios/negocio/${business.id}`} state={{ from: "/negocios" }}>
      <div className="hub-negocio-card-head">
        {image ? <img className="hub-negocio-card-thumb" src={image} alt="" /> : <span className="hub-carousel-card-icon"><Building2 size={18} /></span>}
        <div><strong>{business.name}</strong><small>{SERVICE_LABELS[business.categoryServiceId as LuisServiceId] || business.categoryLabel}</small></div>
      </div>
      <div className="hub-negocio-badges">
        {!business.active ? <span className="hub-negocio-pill is-muted">Pausado</span> : null}
        {business.offersCoupon ? <span className="hub-negocio-pill">Ofrece cupones</span> : null}
        {business.receivesServiceRequests ? <span className="hub-negocio-pill">Recibe consultas</span> : null}
        {!business.offersCoupon && !business.receivesServiceRequests ? <span className="hub-negocio-pill is-muted">Sin configurar</span> : null}
        {business.offersCoupon ? (
          <span className="hub-negocio-pill is-muted">{business.requestCount} {business.requestCount === 1 ? "cupón pedido" : "cupones pedidos"}</span>
        ) : null}
      </div>
    </Link>
  );
}

function NegociosSegment() {
  const { businesses, loading, error, reload } = useBusinessesList();
  const { coupons } = useCouponsList();
  const [creating, setCreating] = useState(false);
  const [createNotice, setCreateNotice] = useState("");
  return (
    <section>
      <div className="hub-section-head">
        <span className="hub-page-count">{businesses.length} {businesses.length === 1 ? "negocio" : "negocios"}</span>
        <button type="button" className="hub-primary" onClick={() => setCreating(true)}><Plus size={16} />Agregar negocio</button>
      </div>
      {createNotice ? <p className="hub-field-hint" role="status">{createNotice}</p> : null}
      {loading ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los negocios" description={error} />
      ) : businesses.length === 0 ? (
        <EmptyState icon={Building2} title="Todavía no hay negocios activos" description="Agregá tu primer negocio con el botón de arriba." />
      ) : (
        <div className="hub-campaign-grid">
          {businesses.map((business) => <BusinessCard key={business.id} business={business} coupons={coupons} />)}
        </div>
      )}
      {creating ? (
        <NewBusinessDrawer
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            await dataSource.createBusiness(input);
            setCreating(false);
            setCreateNotice(dataSource.capabilities.canCreateBusiness ? "Negocio creado." : "Negocio agregado localmente en esta sesión — todavía no se guarda en el servidor.");
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

function useRealServices() {
  const [services, setServices] = useState<RealServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    loadRealServiceRows()
      .then((rows) => { setServices(rows); setError(""); })
      .catch((reason) => setError(String((reason as Error)?.message || reason)))
      .finally(() => setLoading(false));
  }, []);
  return { services, loading, error };
}

function ServiciosSegment() {
  const { services, loading, error } = useRealServices();
  if (loading) return <SkeletonRows count={3} />;
  if (error) return <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los servicios" description={error} />;
  const benefits = services.filter((s) => s.kind === "benefit");
  const professional = services.filter((s) => s.kind === "professional");
  return (
    <section>
      <div className="hub-category-group">
        <h2>Beneficios / cupones</h2>
        <div className="hub-list">
          {benefits.map((service) => (
            <Link key={service.serviceId} className="hub-list-row" to={`/clientes?service=${service.serviceId}`}>
              <div><strong>{service.label}</strong><small>{service.hasCustomerFacingRoute ? "Ruta activa en WhatsApp" : "Sin ruta activa"}</small></div>
              <StatusBadge tone="neutral" label={`${service.requestCount} ${service.requestCount === 1 ? "cupón pedido" : "cupones pedidos"}`} />
              <ChevronRight size={16} />
            </Link>
          ))}
        </div>
      </div>
      <div className="hub-category-group">
        <h2>Servicios profesionales</h2>
        <div className="hub-list">
          {professional.map((service) => (
            <Link key={service.serviceId} className="hub-list-row" to={`/clientes?service=${service.serviceId}`}>
              <div><strong>{service.label}</strong><small>Solicitud de asesoría — sin negocio vinculado</small></div>
              <StatusBadge tone="neutral" label={`${service.requestCount} ${service.requestCount === 1 ? "consulta recibida" : "consultas recibidas"}`} />
              <ChevronRight size={16} />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function CuponesSegment() {
  const { businesses } = useBusinessesList();
  const { coupons, loading } = useCouponsList();
  const businessById = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);
  const supermarketCampaignKeys = useMemo(
    () => coupons.filter((c) => isSupermarketCampaignKey(c.campaignKey)).map((c) => c.campaignKey),
    [coupons],
  );
  const locationsByCampaignKey = useSupermarketLocationsByCampaignKey(supermarketCampaignKeys);
  if (loading) return <SkeletonRows count={3} />;
  if (coupons.length === 0) return <EmptyState icon={Tag} title="Sin cupones activos" description="Todavía no hay cupones configurados para esta organización." />;
  return (
    <section className="hub-campaign-grid">
      {coupons.map((coupon) => {
        const isSupermarket = isSupermarketCampaignKey(coupon.campaignKey);
        const locations = isSupermarket ? (locationsByCampaignKey.get(coupon.campaignKey) ?? []) : [];
        const thumbnails = activeLocationThumbnails(locations);
        const extra = extraLocationCount(locations);
        const business = businessById.get(coupon.businessId);
        return (
          <Link key={coupon.id} className="hub-campaign-card" to={`/negocios/cupon/${coupon.id}`} state={{ from: "/negocios?view=cupones" }}>
            {isSupermarket ? (
              thumbnails.length > 0 ? (
                <div className="hub-campaign-image hub-campaign-collage">
                  {thumbnails.map((url, index) => <img key={url + index} src={url} alt="" />)}
                  {extra > 0 ? <span className="hub-campaign-collage-extra">+{extra}</span> : null}
                </div>
              ) : <div className="hub-campaign-image-placeholder">Sin imagen</div>
            ) : (
              coupon.imageUrl ? <img className="hub-campaign-image" src={coupon.imageUrl} alt="" /> : <div className="hub-campaign-image-placeholder">Sin imagen</div>
            )}
            <div className="hub-campaign-body">
              <div className="hub-campaign-body-head">
                <strong>{coupon.displayName}</strong>
                <StatusBadge tone={coupon.active ? "success" : "neutral"} label={coupon.active ? "Activo" : "Pausado"} />
              </div>
              <p className="hub-campaign-meta">{isSupermarket ? supermarketAvailabilityLabel(locations.length) : (business?.name ?? "Sin negocio")}</p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

function CampanasSegment() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const { businesses } = useBusinessesList();
  const { coupons } = useCouponsList();
  const [creating, setCreating] = useState(false);
  const load = () => { setLoading(true); dataSource.listCampaigns().then(setCampaigns).finally(() => setLoading(false)); };
  useEffect(load, []);
  const label = (campaign: Campaign) => {
    const promotes = campaign.promotes;
    if (promotes.kind === "business") return businesses.find((b) => b.id === promotes.businessId)?.name ?? "Negocio";
    if (promotes.kind === "coupon") return coupons.find((c) => c.id === promotes.couponId)?.displayName ?? "Cupón";
    if (promotes.kind === "service") return SERVICE_LABELS[promotes.serviceId as LuisServiceId] ?? "Servicio";
    return "Menú general";
  };
  return (
    <section>
      <div className="hub-section-head">
        <span className="hub-page-count">{campaigns.length} {campaigns.length === 1 ? "campaña" : "campañas"}</span>
        <button type="button" className="hub-primary" onClick={() => setCreating(true)}><Plus size={16} />Nueva campaña</button>
      </div>
      {loading ? (
        <SkeletonRows count={3} />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Tag} title="Sin campañas todavía" description="Una campaña promociona un negocio, cupón, servicio o el menú general que ya exista." />
      ) : (
        <div className="hub-list">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="hub-list-row">
              <div><strong>{campaign.label}</strong><small>Promociona: {label(campaign)}</small></div>
              <StatusBadge tone={campaign.active ? "success" : "neutral"} label={campaign.active ? "Activa" : "Pausada"} />
            </div>
          ))}
        </div>
      )}
      {creating ? (
        <NewCampaignDrawer
          businesses={businesses}
          coupons={coupons}
          onClose={() => setCreating(false)}
          onCreate={async (input) => { await dataSource.createCampaign(input); setCreating(false); load(); }}
        />
      ) : null}
    </section>
  );
}

function NewCampaignDrawer({ businesses, coupons, onClose, onCreate }: {
  businesses: Business[];
  coupons: Coupon[];
  onClose: () => void;
  onCreate: (input: { label: string; promotes: { kind: "business"; businessId: string } | { kind: "coupon"; couponId: string } | { kind: "menu" } }) => Promise<void>;
}) {
  const options = [
    { id: "menu", label: "Menú general" },
    ...businesses.map((b) => ({ id: `business:${b.id}`, label: `Negocio — ${b.name}` })),
    ...coupons.map((c) => ({ id: `coupon:${c.id}`, label: `Cupón — ${c.displayName}` })),
  ];
  const [selection, setSelection] = useState(options[0]?.id ?? "menu");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setSaving(true);
    setError("");
    try {
      const [kind, id] = selection.split(":");
      const promotes = kind === "business" ? { kind: "business" as const, businessId: id } : kind === "coupon" ? { kind: "coupon" as const, couponId: id } : { kind: "menu" as const };
      await onCreate({ label: label.trim() || options.find((o) => o.id === selection)?.label || "Campaña", promotes });
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <button type="button" className="hub-drawer-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="hub-drawer" role="dialog" aria-label="Nueva campaña">
        <div className="hub-drawer-header"><h2>Nueva campaña</h2><button type="button" className="hub-drawer-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="hub-drawer-body">
          <div className="hub-field">
            <label htmlFor="campaign-label">Nombre de la campaña</label>
            <input id="campaign-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej. Flyer consultorio Dr. Pérez" />
          </div>
          <div className="hub-field">
            <label htmlFor="campaign-promotes">Qué promociona</label>
            <select id="campaign-promotes" value={selection} onChange={(e) => setSelection(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="hub-field-hint">Elegí un negocio, cupón o el menú general ya configurado — una campaña no crea un destino nuevo.</p>
          </div>
          {error ? <p className="hub-account-error" role="alert">{error}</p> : null}
        </div>
        <div className="hub-drawer-footer">
          <button type="button" className="hub-primary" disabled={saving} onClick={() => void submit()}>{saving ? "Creando…" : "Crear campaña"}</button>
        </div>
      </div>
    </>
  );
}
