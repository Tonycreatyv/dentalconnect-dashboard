import { AlertTriangle, PackageCheck, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { filterMercaditoOrders, MERCADITO_STATUS_LABELS, mercaditoStatusLabel } from "../operations/mercaditoOrders";
import { useMercaditoOrders } from "../operations/useMercaditoOrders";
import { PERIOD_TABS, type PeriodId } from "../operations/period";
import DropdownFilter from "../ui/DropdownFilter";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";

const STATUS_TONES: Record<string, StatusTone> = { NEW: "neutral", CONFIRMED: "warning", PREPARING: "warning", READY: "success", COMPLETED: "success", CANCELED: "danger" };

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatTotal(cents: number, currency: string) {
  return new Intl.NumberFormat("es-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

export default function MercaditoOrdersScreen() {
  const [params, setParams] = useSearchParams();
  const period = (params.get("period") as PeriodId) || "month";
  const supermarket = params.get("supermercado") || "";
  const status = params.get("estado") || "";
  const { rows, loading, error, load } = useMercaditoOrders(period);
  const setParam = (key: string, value: string) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; });
  const supermarketOptions = useMemo(() => [...new Set(rows.map((row) => row.businessName))].sort().map((value) => ({ value, label: value })), [rows]);
  const filtered = useMemo(() => filterMercaditoOrders(rows, supermarket, status), [rows, supermarket, status]);

  return <div className="hub-page hub-page--wide">
    <PageHeader eyebrow="Mercadito" title="Pedidos" subtitle="Pedidos de Mercadito Online. Vista de consulta." meta={<span className="hub-page-count">{filtered.length} {filtered.length === 1 ? "pedido" : "pedidos"}</span>} actions={<button type="button" className="hub-secondary" onClick={() => void load()}><RefreshCw size={16} />Actualizar</button>} />
    <div className="hub-filter-row">
      <DropdownFilter label="Supermercado" value={supermarket} onChange={(value) => setParam("supermercado", value)} options={supermarketOptions} />
      <DropdownFilter label="Estado" value={status} onChange={(value) => setParam("estado", value)} options={Object.entries(MERCADITO_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      <DropdownFilter label="Período" value={period} onChange={(value) => setParam("period", value)} options={PERIOD_TABS.filter((tab) => tab.id !== "custom").map((tab) => ({ value: tab.id, label: tab.label }))} />
    </div>
    {loading ? <SkeletonRows count={5} /> : error ? <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los pedidos" description={error} /> : filtered.length === 0 ? <EmptyState icon={PackageCheck} title="Sin pedidos" description="No hay pedidos de Mercadito que coincidan con estos filtros." /> : <div className="hub-table hub-orders-table">
      <div className="hub-table-head"><span>Pedido</span><span>Cliente</span><span>Despensa</span><span>Supermercado</span><span>ZIP</span><span>Total</span><span>Estado</span><span>Fecha</span></div>
      {filtered.map((row) => <article key={row.id} className="hub-table-row">
        <div className="hub-table-cell hub-table-cell-primary" data-label="Pedido">{row.orderNumber}</div>
        <div className="hub-table-cell" data-label="Cliente">{row.customerName}</div>
        <div className="hub-table-cell" data-label="Despensa">{row.productName}</div>
        <div className="hub-table-cell" data-label="Supermercado">{row.businessName}</div>
        <div className="hub-table-cell hub-table-cell-muted" data-label="ZIP">{row.zip}</div>
        <div className="hub-table-cell" data-label="Total">{formatTotal(row.totalCents, row.currency)}</div>
        <div className="hub-table-cell" data-label="Estado"><StatusBadge tone={STATUS_TONES[row.status] ?? "neutral"} label={mercaditoStatusLabel(row.status)} /></div>
        <time className="hub-table-cell hub-table-cell-time" data-label="Fecha">{formatDateTime(row.createdAt)}</time>
      </article>)}
    </div>}
  </div>;
}
