import { ArrowLeft, Check, ChevronRight, Eye, MapPin, Package, Pencil, Ticket, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { GROCERY_CUSTOMER_PREVIEW, serviceDescription, serviceIcon, serviceTitle, type ReferralService } from "./serviceExperienceModel";

type Campaign = { id: string; service_id: string; display_name: string | null; active: boolean; offer_terms: Record<string, unknown> | null };
type BasketOffer = { id: string; partner_location_id: string; active: boolean };
type Coverage = { id: string; partner_location_id: string; active: boolean };
type Location = { id: string; active: boolean; delivery_enabled: boolean };
type PreviewState = "entry" | "coupon";

function couponBenefit(campaign: Campaign | undefined) {
  if (!campaign) return "Beneficio configurado";
  const terms = campaign.offer_terms ?? {};
  const amount = [terms.discount_amount, terms.amount, terms.discount_value, terms.value].find((value) => typeof value === "number" || typeof value === "string");
  if (typeof amount === "number") return new Intl.NumberFormat("es-US", { style: "currency", currency: "USD" }).format(amount);
  if (typeof amount === "string" && amount.trim()) return amount;
  return campaign.display_name || "Beneficio configurado";
}

function CustomerPreview({ state }: { state: PreviewState }) {
  const afterCoupon = state === "coupon";
  const preview = afterCoupon ? GROCERY_CUSTOMER_PREVIEW.afterCoupon : GROCERY_CUSTOMER_PREVIEW.entry;
  return <div className="rh-phone" aria-label={afterCoupon ? "Vista previa después del cupón" : "Vista previa de entrada"}>
    <div className="rh-phone-top"><span>LG Community Network</span><small>en línea</small></div>
    <div className="rh-phone-chat">
      <p>{preview.message}</p>{preview.actions.map((action) => <button key={action}>{action}</button>)}
    </div>
  </div>;
}

function GroceryPreview() {
  const [state, setState] = useState<PreviewState>("entry");
  const [open, setOpen] = useState(false);
  const content = <><div className="rh-preview-tabs" role="tablist" aria-label="Estado de vista previa"><button type="button" role="tab" aria-selected={state === "entry"} onClick={() => setState("entry")}>Entrada</button><button type="button" role="tab" aria-selected={state === "coupon"} onClick={() => setState("coupon")}>Después del cupón</button></div><CustomerPreview state={state} /></>;
  return <><aside className="rh-preview-desktop"><header><span><Eye />VISTA DEL CLIENTE</span><p>Así se verá la experiencia en WhatsApp.</p></header>{content}</aside><button type="button" className="rh-preview-trigger" onClick={() => setOpen(true)}><Eye />Ver experiencia del cliente</button>{open ? <div className="rh-preview-sheet" role="dialog" aria-modal="true" aria-label="Experiencia del cliente"><div><header><strong>Experiencia del cliente</strong><button type="button" onClick={() => setOpen(false)}>Cerrar</button></header>{content}</div></div> : null}</>;
}

export default function ReferralServiceDetail() {
  const { serviceId = "" } = useParams();
  const { resolvedOrgId } = useReferralOrganization();
  const [service, setService] = useState<ReferralService | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [offers, setOffers] = useState<BasketOffer[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!resolvedOrgId || !serviceId) return () => { active = false; };
    void Promise.all([
      supabase.from("service_configs").select("id,nombre,menu_label,menu_orden,activo,tipo,intake_objectives,icono").eq("organization_id", resolvedOrgId).eq("id", serviceId).maybeSingle(),
      supabase.from("referral_coupon_campaigns").select("id,service_id,display_name,active,offer_terms").eq("organization_id", resolvedOrgId),
      supabase.from("referral_basket_offers").select("id,partner_location_id,active").eq("organization_id", resolvedOrgId),
      supabase.from("referral_grocery_delivery_coverage").select("id,partner_location_id,active").eq("organization_id", resolvedOrgId),
      supabase.from("referral_partner_locations").select("id,active,delivery_enabled").eq("organization_id", resolvedOrgId),
    ]).then(([serviceResult, campaignResult, offersResult, coverageResult, locationsResult]) => {
      if (!active) return;
      const next = serviceResult.data as ReferralService | null;
      setService(next); setTitle(next?.menu_label || next?.nombre || ""); setIcon(next?.icono || "");
      setCampaigns((campaignResult.data ?? []) as Campaign[]); setOffers((offersResult.data ?? []) as BasketOffer[]);
      setCoverage((coverageResult.data ?? []) as Coverage[]); setLocations((locationsResult.data ?? []) as Location[]);
      setError(serviceResult.error ? "No pudimos cargar este servicio." : ""); setLoading(false);
    });
    return () => { active = false; };
  }, [resolvedOrgId, serviceId]);

  const isGrocery = service?.id === "luis_compra_super";
  const coupon = useMemo(() => campaigns.find((campaign) => campaign.service_id === "luis_cupon_super"), [campaigns]);
  const activeOffers = offers.filter((offer) => offer.active).length;
  const activeCoverage = coverage.filter((rule) => rule.active).length;
  const activeLocations = locations.filter((location) => location.active && location.delivery_enabled).length;
  const saveCustomerFacing = async () => {
    if (!service || !resolvedOrgId || !title.trim()) return;
    setSaving(true);
    const { error: updateError } = await supabase.from("service_configs").update({ menu_label: title.trim(), icono: icon.trim() || null }).eq("organization_id", resolvedOrgId).eq("id", service.id);
    if (updateError) setError("No pudimos guardar los cambios.");
    else { setService({ ...service, menu_label: title.trim(), icono: icon.trim() || null }); setEditing(false); }
    setSaving(false);
  };

  if (loading) return <main className="bolt-rh-page"><div className="rh-service-empty" role="status">Cargando servicio…</div></main>;
  if (error || !service) return <main className="bolt-rh-page"><Link className="bolt-rh-back" to="/services"><ArrowLeft />Servicios</Link><div className="rh-service-empty" role="alert">{error || "Servicio no encontrado."}</div></main>;

  return <main className="rh-service-detail-page">
    <Link className="bolt-rh-back" to="/services"><ArrowLeft />Servicios</Link>
    <header className="rh-detail-heading"><span>{serviceIcon(service)}</span><div><p className="rh-eyebrow">SERVICIO</p><h1>{serviceTitle(service)}</h1><p>{serviceDescription(service)}</p></div><span className={service.activo ? "rh-available-badge" : "rh-off-badge"}>{service.activo ? <Check /> : null}{service.activo ? "Disponible" : "No disponible"}</span></header>
    {error ? <div className="rh-service-alert" role="alert">{error}</div> : null}
    <div className={isGrocery ? "rh-detail-layout is-grocery" : "rh-detail-layout"}>
      <div className="rh-detail-content">
        <section className="rh-detail-section"><div className="rh-section-title"><div><p>LO QUE VERÁ TU CLIENTE</p><h2>Una presentación clara y reconocible</h2></div><button type="button" onClick={() => setEditing((value) => !value)}><Pencil />{editing ? "Cancelar" : "Editar"}</button></div>
          {editing ? <div className="rh-edit-fields"><label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Icono<input value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={4} /></label><button type="button" disabled={saving || !title.trim()} onClick={() => void saveCustomerFacing()}>{saving ? "Guardando…" : "Guardar cambios"}</button></div> : <div className="rh-customer-face"><span>{serviceIcon(service)}</span><div><strong>{serviceTitle(service)}</strong><p>{serviceDescription(service)}</p></div></div>}
        </section>
        {isGrocery ? <>
          <section className="rh-detail-section"><div className="rh-section-title"><div><p>LO QUE ESTÁS OFRECIENDO</p><h2>Compras y delivery</h2></div></div><div className="rh-offer-cards">
            <Link to="/coupons" className="rh-offer-card"><Ticket /><div><span>CUPÓN</span><strong>{couponBenefit(coupon)}</strong><small>{coupon?.active ? "Activo" : "Revisar configuración"}</small></div><ChevronRight /></Link>
            <Link to="/baskets" className="rh-offer-card"><Package /><div><span>CANASTAS PREPARADAS</span><strong>{activeOffers} {activeOffers === 1 ? "disponible" : "disponibles"}</strong><small>Opciones fijas, no personalizables</small></div><ChevronRight /></Link>
            <Link to="/coverage" className="rh-offer-card"><Truck /><div><span>DELIVERY</span><strong>{activeCoverage} {activeCoverage === 1 ? "zona disponible" : "zonas disponibles"}</strong><small>{activeLocations} {activeLocations === 1 ? "tienda con delivery" : "tiendas con delivery"}</small></div><ChevronRight /></Link>
          </div></section>
          <section className="rh-detail-section"><div className="rh-section-title"><div><p>DÓNDE Y CUÁNDO MOSTRARLO</p><h2>Disponible donde hay cobertura</h2></div></div><div className="rh-location-summary"><MapPin /><span>Disponible en <strong>{activeLocations} {activeLocations === 1 ? "tienda" : "tiendas"}</strong> y <strong>{activeCoverage} {activeCoverage === 1 ? "zona" : "zonas"}</strong>.</span><Link to="/coverage">Administrar cobertura</Link></div></section>
        </> : <section className="rh-detail-section"><div className="rh-section-title"><div><p>LO QUE ESTE SERVICIO OFRECE</p><h2>Configuración simple</h2></div></div><p className="rh-section-copy">Esta experiencia usa la configuración actual del servicio. La disponibilidad y la posición se administran desde Servicios.</p></section>}
      </div>
      {isGrocery ? <GroceryPreview /> : null}
    </div>
  </main>;
}
