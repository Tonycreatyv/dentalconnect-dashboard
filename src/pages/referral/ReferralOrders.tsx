import {
  AlertCircle,
  Clock3,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  RefreshCw,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import { MobileEmptyState, MobileHeader } from "../../components/mobile/MobilePrimitives";
import {
  REFERRAL_ORDER_NEXT_STATUSES,
  REFERRAL_ORDER_STATUS_LABELS,
  type ReferralOrderListItem,
  type ReferralOrderStatusEvent,
} from "../../referral/orders";
import type { ReferralOrderStatus } from "../../referral/orderTypes";
import { useReferralOrders } from "../../referral/useReferralOrders";

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sourceLabel(source: ReferralOrderListItem["source_channel"]) {
  if (source === "whatsapp") return "WhatsApp";
  if (source === "web") return "Landing";
  if (source === "qr") return "Código QR";
  return "Administración";
}

function safePhoneHref(phone: string) {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

function StatusHistory({ events }: { events: ReferralOrderStatusEvent[] }) {
  return (
    <details className="mt-4 rounded-2xl border border-white/[0.07] bg-[#0A151D] open:pb-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-bold text-[#CBD6DF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6FD897]">
        <Clock3 className="h-4 w-4 text-[#6FD897]" />Historial de estado
        <span className="ml-auto text-xs font-normal text-[#7E8C99]">{events.length} eventos</span>
      </summary>
      <ol className="space-y-2 border-t border-white/[0.07] px-3 pt-3">
        {events.map((event) => (
          <li key={event.id} className="grid grid-cols-[8px_minmax(0,1fr)] gap-2 text-xs">
            <span className="mt-1.5 h-2 w-2 rounded-full bg-[#6FD897]" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-bold text-[#DDE5EC]">{REFERRAL_ORDER_STATUS_LABELS[event.to_status]}</p>
              <p className="text-[#7E8C99]">{formatCreatedAt(event.created_at)} · {event.actor_type === "staff" ? "Equipo" : "Sistema"}</p>
              {event.note ? <p className="mt-1 break-words text-[#9AA8B4]">{event.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ReferralOrderCard({
  order,
  events,
  updating,
  onUpdateStatus,
}: {
  order: ReferralOrderListItem;
  events: ReferralOrderStatusEvent[];
  updating: boolean;
  onUpdateStatus: (status: ReferralOrderStatus) => void;
}) {
  const nextStatuses = REFERRAL_ORDER_NEXT_STATUSES[order.status] ?? [];
  return (
    <article className="min-w-0 rounded-3xl border border-[#203342] bg-[#101E29] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all text-[10px] font-bold uppercase tracking-[0.16em] text-[#6FD897]">{order.order_code}</p>
          <h2 className="mt-1 break-words text-base font-black text-[#F4F7FA]">{order.basket_name_snapshot}</h2>
          <p className="mt-1 text-xs text-[#8594A2]">{formatCreatedAt(order.created_at)} · {sourceLabel(order.source_channel)}</p>
        </div>
        <span className="rounded-full border border-[#6FD897]/20 bg-[#6FD897]/10 px-2.5 py-1 text-[11px] font-bold text-[#8BE6AC]">
          {REFERRAL_ORDER_STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      <dl className="mt-4 grid min-w-0 gap-3 text-sm md:grid-cols-3">
        <div className="min-w-0 rounded-2xl bg-[#0A151D] p-3">
          <dt className="flex items-center gap-2 text-xs text-[#7E8C99]"><UserRound className="h-3.5 w-3.5" />Cliente</dt>
          <dd className="mt-1 break-words font-bold text-[#EAF0F5]">{order.customer_name}</dd>
          <dd className="mt-1">
            <a href={safePhoneHref(order.customer_phone)} className="inline-flex min-h-11 max-w-full items-center gap-2 break-all rounded-xl px-2 text-sm font-bold text-[#8BE6AC] hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6FD897]">
              <Phone className="h-3.5 w-3.5 shrink-0" />{order.customer_phone}
            </a>
          </dd>
        </div>
        <div className="min-w-0 rounded-2xl bg-[#0A151D] p-3">
          <dt className="flex items-center gap-2 text-xs text-[#7E8C99]"><ShoppingBag className="h-3.5 w-3.5" />Supermercado</dt>
          <dd className="mt-1 break-words font-bold text-[#EAF0F5]">{order.partner_name_snapshot}</dd>
          <dd className="break-words text-xs text-[#91A0AD]">{order.partner_location_name_snapshot}</dd>
        </div>
        <div className="min-w-0 rounded-2xl bg-[#0A151D] p-3">
          <dt className="flex items-center gap-2 text-xs text-[#7E8C99]"><MapPin className="h-3.5 w-3.5" />Entrega</dt>
          <dd className="mt-1 break-words font-bold text-[#EAF0F5]">{order.delivery_address}</dd>
          <dd className="break-words text-xs text-[#91A0AD]">{order.delivery_city}, {order.delivery_state} {order.delivery_postal_code}</dd>
          <dd className="mt-1 text-xs font-medium text-[#8BE6AC]">Cobertura disponible</dd>
        </div>
      </dl>

      {order.customer_notes ? (
        <div className="mt-3 flex min-w-0 gap-2 rounded-2xl border border-amber-300/10 bg-amber-300/[0.04] p-3 text-sm text-amber-50/80">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0"><p className="text-xs font-bold text-amber-100">Instrucciones</p><p className="mt-1 break-words">{order.customer_notes}</p></div>
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4 text-right">
        <div className="min-w-0"><dt className="text-[10px] uppercase tracking-wide text-[#71808D]">Subtotal</dt><dd className="mt-1 break-words text-sm font-bold text-[#DDE5EC]">{formatMoney(order.subtotal_cents, order.currency)}</dd></div>
        <div className="min-w-0"><dt className="text-[10px] uppercase tracking-wide text-[#71808D]">Entrega</dt><dd className="mt-1 break-words text-sm font-bold text-[#DDE5EC]">{formatMoney(order.delivery_fee_cents, order.currency)}</dd></div>
        <div className="min-w-0"><dt className="text-[10px] uppercase tracking-wide text-[#6FD897]">Total</dt><dd className="mt-1 break-words text-base font-black text-[#8BE6AC]">{formatMoney(order.total_cents, order.currency)}</dd></div>
      </dl>

      {nextStatuses.length > 0 ? (
        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <p className="text-xs font-bold text-[#91A0AD]">Actualizar pedido</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {nextStatuses.map((status) => (
              <button
                key={status}
                type="button"
                disabled={updating}
                onClick={() => onUpdateStatus(status)}
                className={status === "cancelled"
                  ? "min-h-11 rounded-xl border border-rose-300/20 px-4 text-sm font-bold text-rose-200 hover:bg-rose-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-wait disabled:opacity-50"
                  : "min-h-11 rounded-xl bg-[#6FD897] px-4 text-sm font-black text-[#07130C] hover:bg-[#83E5A6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A7F3C0] disabled:cursor-wait disabled:opacity-50"}
              >
                {updating ? "Actualizando…" : REFERRAL_ORDER_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <StatusHistory events={events} />
    </article>
  );
}

export default function ReferralOrders() {
  const { organizationId, orders, eventsByOrder, loading, error, actionError, updatingOrderId, load, updateStatus } = useReferralOrders();

  if (!organizationId && !loading) {
    return <main className="referral-page"><MobileEmptyState title="Referral Hub no está configurado" description="Selecciona una organización de Referral Hub a la que tengas acceso." /></main>;
  }

  return (
    <main className="referral-page min-w-0 overflow-x-hidden">
      <MobileHeader eyebrow="Operación" title="Pedidos" subtitle="Pedidos preparados recibidos desde WhatsApp y la landing" />
      {actionError ? <div className="mb-3 rounded-2xl border border-rose-400/20 bg-rose-500/[0.06] p-3 text-sm text-rose-100" role="alert">{actionError}</div> : null}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-[#8D9AA6]" role="status"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Cargando pedidos…</div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/[0.06] p-5" role="alert">
          <div className="flex items-center gap-2 font-bold text-rose-200"><AlertCircle className="h-4 w-4" />No se pudieron cargar los pedidos</div>
          <p className="mt-2 text-sm text-rose-100/70">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-2xl bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6FD897]">Reintentar</button>
        </div>
      ) : orders.length === 0 ? (
        <MobileEmptyState title="No hay pedidos todavía" description="Los pedidos recibidos desde WhatsApp y la landing aparecerán aquí." icon={PackageCheck} />
      ) : (
        <div className="min-w-0 space-y-3">{orders.map((order) => (
          <ReferralOrderCard
            key={order.order_code}
            order={order}
            events={eventsByOrder[order.id] ?? []}
            updating={updatingOrderId === order.id}
            onUpdateStatus={(status) => void updateStatus(order.id, status)}
          />
        ))}</div>
      )}
    </main>
  );
}
