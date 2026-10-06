import { AlertTriangle, Building2, Gift, MapPin, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { getActiveNegociosDataSource } from "../negocios/dataSource";
import type { Business, Coupon, SupermarketLocation } from "../negocios/types";
import { isSupermarketCampaignKey } from "../negocios/supermarketCoupon";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";
import "./benefitsWorkspace.css";

const dataSource = getActiveNegociosDataSource();
const ORGANIZATION_ID = "luis-gabriel-referral-hub";

type BenefitCard = Coupon & {
  locations: SupermarketLocation[];
  business: Business | null;
  claimCount: number;
};

export default function BenefitsWorkspace() {
  const [cards, setCards] = useState<BenefitCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [coupons, businesses, claims] = await Promise.all([
          dataSource.listCoupons(),
          dataSource.listBusinesses(),
          supabase.from("referral_benefit_claims").select("campaign_id").eq("organization_id", ORGANIZATION_ID),
        ]);
        const businessById = new Map(businesses.map((business) => [business.id, business]));
        const claimsByCampaign = new Map<string, number>();
        for (const row of (claims.data ?? []) as Array<{ campaign_id: string }>) {
          claimsByCampaign.set(row.campaign_id, (claimsByCampaign.get(row.campaign_id) ?? 0) + 1);
        }
        const locations = await Promise.all(coupons.map(async (coupon) => {
          if (!isSupermarketCampaignKey(coupon.campaignKey)) return [] as SupermarketLocation[];
          return dataSource.listSupermarketLocations(coupon.campaignKey);
        }));
        if (!active) return;
        setCards(coupons.map((coupon, index) => ({
          ...coupon,
          locations: locations[index],
          business: businessById.get(coupon.businessId) ?? null,
          claimCount: claimsByCampaign.get(coupon.id) ?? 0,
        })));
        setError("");
      } catch (reason) {
        if (active) setError(String((reason as Error)?.message || reason));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const published = useMemo(() => cards.filter((item) => !item.campaignKey.startsWith("admin_draft_") && item.active), [cards]);
  const paused = useMemo(() => cards.filter((item) => !item.campaignKey.startsWith("admin_draft_") && !item.active), [cards]);
  const drafts = useMemo(() => cards.filter((item) => item.campaignKey.startsWith("admin_draft_")), [cards]);
  const totalClaims = useMemo(() => published.reduce((sum, item) => sum + item.claimCount, 0), [published]);

  if (loading) return <div className="hub-page"><SkeletonRows count={5} /></div>;
  if (error) return <div className="hub-page"><EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los beneficios" description={error} /></div>;

  return (
    <div className="hub-page benefits-v3">
      <PageHeader
        eyebrow="Benefits workspace"
        title="Beneficios"
        subtitle="Qué ofertas están activas, dónde se entregan y qué necesita revisión."
      />

      <section className="benefits-v3-summary" aria-label="Resumen de beneficios">
        <div><strong>{published.length}</strong><span>activos</span></div>
        <div><strong>{totalClaims}</strong><span>solicitudes registradas</span></div>
        <div><strong>{paused.length}</strong><span>pausados</span></div>
        <div><strong>{drafts.length}</strong><span>borradores</span></div>
      </section>

      <section className="benefits-v3-shortcuts" aria-label="Acciones de beneficios">
        <Link to="/negocios/solicitudes"><Send size={18} /><span><strong>Entregas</strong><small>Ver solicitudes y resultados</small></span></Link>
        <Link to="/network/stores"><MapPin size={18} /><span><strong>Ubicaciones</strong><small>ZIPs, flyers y cobertura</small></span></Link>
        <Link to="/negocios"><Building2 size={18} /><span><strong>Negocios</strong><small>Comercios y aliados</small></span></Link>
      </section>

      <section className="benefits-v3-section">
        <div className="benefits-v3-section-head"><div><small>CATÁLOGO</small><h2>Beneficios activos</h2></div><span>{published.length}</span></div>
        {published.length === 0 ? (
          <EmptyState icon={Gift} title="No hay beneficios activos" />
        ) : (
          <div className="benefits-v3-grid">
            {published.map((benefit) => (
              <Link key={benefit.id} className="benefits-v3-card" to={`/negocios/cupon/${benefit.id}`} state={{ from: "/beneficios" }}>
                <div className="benefits-v3-card-main">
                  <div className="benefits-v3-icon"><Gift size={18} /></div>
                  <div>
                    <strong>{benefit.displayName}</strong>
                    <small>{benefit.locations.length > 0
                      ? `${benefit.locations.length} ${benefit.locations.length === 1 ? "ubicación" : "ubicaciones"}`
                      : benefit.business?.name || "Beneficio configurado"}</small>
                  </div>
                  <span className="benefits-v3-status">Activo</span>
                </div>
                <div className="benefits-v3-card-meta">
                  <span><strong>{benefit.claimCount}</strong> solicitudes</span>
                  {benefit.locations.length > 0 ? <span>{benefit.locations.map((location) => location.postalCode).filter(Boolean).join(" · ")}</span> : null}
                </div>
                <div className="benefits-v3-card-action">Administrar <span aria-hidden="true">→</span></div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {(paused.length > 0 || drafts.length > 0) ? (
        <section className="benefits-v3-secondary">
          {paused.length > 0 ? <Link to="/negocios?view=cupones">{paused.length} pausado{paused.length === 1 ? "" : "s"} · revisar</Link> : null}
          {drafts.length > 0 ? <Link to="/negocios?view=cupones">{drafts.length} borrador{drafts.length === 1 ? "" : "es"}</Link> : null}
        </section>
      ) : null}
    </div>
  );
}
