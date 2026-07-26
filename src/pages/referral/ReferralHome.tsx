import { AlertCircle, ArrowRight, Loader2, PackageCheck, ShoppingBag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  REFERRAL_ORDER_STATUS_LABELS,
  getReferralOrderHomeMetrics,
  type ReferralOrderListItem,
} from "../../referral/orders";
import { useReferralOrders } from "../../referral/useReferralOrders";

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatOrderTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Hora no disponible";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("es-US", sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(date);
}

function RecentOrderRow({ order, onOpen }: { order: ReferralOrderListItem; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="referral-order-row" aria-label={`Abrir pedido ${order.order_code}`}>
      <span className="referral-order-row-icon" aria-hidden="true"><ShoppingBag className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="truncate text-[13px] font-bold text-[#F2F6F8]">{order.customer_name}</strong>
          <span className="shrink-0 text-[10px] font-bold text-[#7D8A96]">{order.order_code}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[#7D8A96]">{order.basket_name_snapshot}</span>
      </span>
      <span className="shrink-0 text-right">
        <strong className="block text-xs font-bold text-[#E7ECEF]">{formatMoney(order.total_cents, order.currency)}</strong>
        <span className="mt-0.5 block text-[10px] text-[#6F7D89]">{formatOrderTime(order.created_at)}</span>
      </span>
      <span className={`referral-order-status referral-order-status-${order.status}`}>
        {REFERRAL_ORDER_STATUS_LABELS[order.status]}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#52606C]" aria-hidden="true" />
    </button>
  );
}

export default function ReferralHome() {
  const navigate = useNavigate();
  const { organizationId, orders, loading, error, load } = useReferralOrders();
  const metrics = getReferralOrderHomeMetrics(orders);
  const actionableCount = metrics.received + metrics.preparing + metrics.outForDelivery;

  if (!organizationId && !loading) return <ReferralConfigurationState />;

  return (
    <main className="referral-page referral-operations-home">
      <header className="referral-home-header">
        <p className="referral-eyebrow">Referral Hub</p>
        <h1>Buenos días, Luis</h1>
        <p>{actionableCount === 0 ? "No hay pedidos activos ahora" : `${actionableCount} ${actionableCount === 1 ? "pedido requiere" : "pedidos requieren"} seguimiento`}</p>
      </header>

      <section className="referral-order-metrics" aria-label="Resumen de pedidos">
        {[
          { value: metrics.received, label: "Recibidos", tone: "received" },
          { value: metrics.preparing, label: "Preparando", tone: "preparing" },
          { value: metrics.outForDelivery, label: "En camino", tone: "delivery" },
        ].map((item) => (
          <div key={item.label} className={`referral-order-metric referral-order-metric-${item.tone}`}>
            <span aria-hidden="true" />
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </div>
        ))}
      </section>

      <section className="referral-recent-orders" aria-labelledby="recent-orders-title">
        <div className="referral-compact-heading">
          <div><p className="referral-eyebrow">Operación</p><h2 id="recent-orders-title">Pedidos recientes</h2></div>
          <button type="button" onClick={() => navigate("/orders")}>Ver todos <ArrowRight className="h-3.5 w-3.5" /></button>
        </div>

        {loading ? <ReferralLoading /> : error ? <ReferralError message={error} onRetry={() => void load()} /> : orders.length === 0 ? (
          <div className="referral-orders-empty">
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            <span><strong>Sin pedidos recientes</strong><small>Los nuevos pedidos aparecerán aquí.</small></span>
          </div>
        ) : (
          <div className="referral-order-list">
            {orders.slice(0, 3).map((order) => <RecentOrderRow key={order.id} order={order} onOpen={() => navigate("/orders")} />)}
          </div>
        )}
      </section>
    </main>
  );
}

export function ReferralLoading() { return <div className="referral-home-feedback" role="status"><Loader2 className="h-4 w-4 animate-spin" /><span>Cargando pedidos…</span></div>; }
export function ReferralError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="referral-home-feedback referral-home-feedback-error" role="alert"><AlertCircle className="h-4 w-4" /><span>{message}</span><button onClick={onRetry}>Reintentar</button></div>; }
export function ReferralConfigurationState() { return <main className="referral-page"><div className="referral-orders-empty"><AlertCircle className="h-4 w-4" /><span><strong>Referral Hub no está disponible</strong><small>Selecciona una organización de Referral Hub.</small></span></div></main>; }
