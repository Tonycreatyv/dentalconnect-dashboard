import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Gift, MapPin, Search } from "lucide-react";
import Avatar from "../ui/Avatar";
import EmptyState from "../ui/EmptyState";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";
import { useCouponDemand, SIN_LOCALIDAD_KEY, type CouponClaimRow } from "../operations/useCouponDemand";
import type { PeriodId } from "../operations/period";
import "./benefitDeliveries.css";

type DeliveryPeriod = "today" | "yesterday" | "week" | "month" | "all" | "specific";
type DeliveryStatus = "all" | CouponClaimRow["status"];

const PERIOD_OPTIONS: Array<{ id: DeliveryPeriod; label: string }> = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "week", label: "7 días" },
  { id: "month", label: "30 días" },
  { id: "all", label: "Todo" },
  { id: "specific", label: "Fecha" },
];

const STATUS_OPTIONS: Array<{ id: DeliveryStatus; label: string }> = [
  { id: "all", label: "Todos los estados" },
  { id: "REQUESTED", label: "Solicitado" },
  { id: "ISSUED", label: "Enviado" },
  { id: "REDEEMED", label: "Usado" },
];

const STATUS_LABEL: Record<CouponClaimRow["status"], string> = {
  REQUESTED: "Solicitado",
  ISSUED: "Enviado",
  REDEEMED: "Usado",
};

const STATUS_TONE: Record<CouponClaimRow["status"], StatusTone> = {
  REQUESTED: "warning",
  ISSUED: "success",
  REDEEMED: "neutral",
};

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function yesterdayKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function initialPeriod(value: string | null): DeliveryPeriod {
  if (value === "week" || value === "month" || value === "all") return value;
  return "today";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function deliveryScope(mode: DeliveryPeriod, specificDate: string): { period: PeriodId; customRange?: { start: string; end: string } } {
  if (mode === "yesterday") {
    const value = yesterdayKey();
    return { period: "custom", customRange: { start: value, end: value } };
  }
  if (mode === "specific" && specificDate) return { period: "custom", customRange: { start: specificDate, end: specificDate } };
  if (mode === "week" || mode === "month" || mode === "all") return { period: mode };
  return { period: "today" };
}

export default function BenefitDeliveriesScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState<DeliveryPeriod>(() => initialPeriod(searchParams.get("period")));
  const [specificDate, setSpecificDate] = useState("");
  const [status, setStatus] = useState<DeliveryStatus>((searchParams.get("status") as DeliveryStatus) || "all");
  const [campaignKey, setCampaignKey] = useState(searchParams.get("campaign") || "");
  const [locationKey, setLocationKey] = useState(searchParams.get("location") || "");
  const [query, setQuery] = useState("");

  const scope = useMemo(() => deliveryScope(period, specificDate), [period, specificDate]);
  const demand = useCouponDemand(scope.period, scope.customRange);

  const campaigns = useMemo(() => {
    const values = new Map<string, string>();
    demand.rawClaims.forEach((claim) => values.set(claim.campaign_key, claim.campaign_label));
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [demand.rawClaims]);

  const locations = useMemo(() => {
    const values = new Map<string, string>();
    demand.rawClaims.forEach((claim) => {
      if (claim.location_key && claim.location_key !== SIN_LOCALIDAD_KEY) values.set(claim.location_key, claim.location_label || claim.location_key);
    });
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [demand.rawClaims]);

  const claims = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return demand.rawClaims.filter((claim) => {
      if (status !== "all" && claim.status !== status) return false;
      if (campaignKey && claim.campaign_key !== campaignKey) return false;
      if (locationKey && claim.location_key !== locationKey) return false;
      if (!needle) return true;
      return [claim.lead_name, claim.campaign_label, claim.postal_code, claim.location_label, claim.claim_code]
        .some((value) => value?.toLocaleLowerCase("es").includes(needle));
    });
  }, [demand.rawClaims, status, campaignKey, locationKey, query]);

  const counts = useMemo(() => ({
    total: claims.length,
    requested: claims.filter((claim) => claim.status === "REQUESTED").length,
    issued: claims.filter((claim) => claim.status === "ISSUED").length,
    redeemed: claims.filter((claim) => claim.status === "REDEEMED").length,
  }), [claims]);

  const hasFilters = status !== "all" || Boolean(campaignKey) || Boolean(locationKey) || Boolean(query.trim()) || period !== "today";

  const syncPeriod = (next: DeliveryPeriod) => {
    setPeriod(next);
    if (next !== "specific") setSpecificDate("");
    const params = new URLSearchParams(searchParams);
    if (next === "today") params.delete("period");
    else if (next === "week" || next === "month" || next === "all") params.set("period", next);
    else params.delete("period");
    setSearchParams(params, { replace: true });
  };

  const clearFilters = () => {
    setPeriod("today");
    setSpecificDate("");
    setStatus("all");
    setCampaignKey("");
    setLocationKey("");
    setQuery("");
    setSearchParams({}, { replace: true });
  };

  return (
    <div className="hub-page benefit-deliveries-page">
      <Link className="hub-back" to="/beneficios"><ArrowLeft />Volver a Beneficios</Link>

      <div className="benefit-deliveries-head">
        <div>
          <span className="benefit-deliveries-eyebrow">BENEFITS WORKSPACE</span>
          <h1>Entregas</h1>
          <p>Consulta pedidos, envíos y usos por día, beneficio, ubicación y estado.</p>
        </div>
        <div className="benefit-deliveries-total"><strong>{counts.total}</strong><span>{counts.total === 1 ? "registro" : "registros"}</span></div>
      </div>

      <div className="benefit-delivery-period" aria-label="Período">
        {PERIOD_OPTIONS.map((option) => (
          <button key={option.id} type="button" className={period === option.id ? "is-active" : ""} onClick={() => syncPeriod(option.id)}>{option.label}</button>
        ))}
      </div>

      {period === "specific" ? (
        <div className="benefit-specific-date">
          <label><span>Fecha específica</span><input type="date" value={specificDate} onChange={(event) => setSpecificDate(event.target.value)} /></label>
          {specificDate ? <button type="button" onClick={() => setSpecificDate("")}>Quitar fecha ×</button> : null}
        </div>
      ) : null}

      <div className="benefit-deliveries-stats">
        <div><Clock3 size={18} /><strong>{counts.requested}</strong><span>Solicitados</span></div>
        <div><CheckCircle2 size={18} /><strong>{counts.issued}</strong><span>Enviados</span></div>
        <div><Gift size={18} /><strong>{counts.redeemed}</strong><span>Usados</span></div>
      </div>

      <div className="benefit-deliveries-filters">
        <label><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value as DeliveryStatus)}>{STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label><span>Beneficio</span><select value={campaignKey} onChange={(event) => setCampaignKey(event.target.value)}><option value="">Todos los beneficios</option>{campaigns.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label><span>Ubicación</span><select value={locationKey} onChange={(event) => setLocationKey(event.target.value)}><option value="">Todas las ubicaciones</option><option value={SIN_LOCALIDAD_KEY}>Ubicación pendiente</option>{locations.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="benefit-deliveries-search"><span>Buscar</span><div><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, ZIP o código" /></div></label>
      </div>

      <div className="benefit-deliveries-resultbar">
        <span><strong>{claims.length}</strong> {claims.length === 1 ? "resultado" : "resultados"}</span>
        {hasFilters ? <button type="button" onClick={clearFilters}>Limpiar filtros</button> : null}
      </div>

      {demand.loading ? (
        <SkeletonRows count={5} />
      ) : demand.error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar las entregas" description={demand.error} />
      ) : period === "specific" && !specificDate ? (
        <EmptyState icon={Clock3} title="Elige una fecha" description="Selecciona el día que quieres revisar." />
      ) : claims.length === 0 ? (
        <EmptyState icon={Gift} title="Sin entregas con estos filtros" description="Prueba otro período, beneficio, ubicación o estado." />
      ) : (
        <div className="benefit-deliveries-list">
          {claims.map((claim) => (
            <Link key={claim.id} className="benefit-delivery-row" to={`/clientes/${claim.lead_id}`} state={{ from: `/negocios/solicitudes?${searchParams.toString()}` }}>
              <Avatar name={claim.lead_name} seed={claim.lead_id} />
              <div className="benefit-delivery-main">
                <div className="benefit-delivery-title"><strong>{claim.lead_name}</strong><StatusBadge tone={STATUS_TONE[claim.status]} label={STATUS_LABEL[claim.status]} /></div>
                <span>{claim.campaign_label}</span>
                <small>{formatDateTime(claim.requested_at)}</small>
              </div>
              <div className="benefit-delivery-meta">
                <span><MapPin size={14} />{claim.location_key === SIN_LOCALIDAD_KEY ? "Ubicación pendiente" : (claim.location_label || "Sin ubicación")}</span>
                <small>ZIP {claim.postal_code || "—"}</small>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
