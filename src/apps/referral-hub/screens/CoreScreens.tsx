import { AlertTriangle, ArrowLeft, CheckCircle2, ShoppingBag, Store } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useReferralOrders } from "../../../referral/useReferralOrders";
import { REFERRAL_ORDER_NEXT_STATUSES, REFERRAL_ORDER_STATUS_LABELS } from "../../../referral/orders";
import type { ReferralOrderStatus } from "../../../referral/orderTypes";
import { useOperationalPilot } from "../operations/useOperationalPilot";
import { groceryLocations, latestFailedNotifications } from "../operations/referralDataMapping";
import Avatar from "../ui/Avatar";
import PageHeader from "../ui/PageHeader";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";
import FilterTabs from "../ui/FilterTabs";
import EmptyState from "../ui/EmptyState";
import { SkeletonRows } from "../ui/Skeleton";
import { Table, TableCell, TableHead, TableRow } from "../ui/Table";

function formatDate(value: unknown) { const date = new Date(String(value ?? "")); return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function serviceLabel(value: unknown) { return String(value ?? "Servicio").replace(/^luis_/, "").replace(/_/g, " "); }
function rowId(value: unknown) { return String(value ?? ""); }
function rowText(value: unknown, fallback = "") { return typeof value === "string" || typeof value === "number" ? String(value) : fallback; }
function partnerName(item: { commercial_name?: unknown; name?: unknown; legal_name?: unknown } | null | undefined) { return String(item?.commercial_name || item?.name || item?.legal_name || "Aliado"); }

type WorkCaseRow = { id: string; tone: StatusTone; title: string; detail: string; source: string; timestamp: unknown };

function workToneLabel(tone: StatusTone) {
  if (tone === "danger") return "Requiere acción";
  if (tone === "warning") return "En seguimiento";
  return "Resuelto";
}

export function WorkScreen() {
  const pilot = useOperationalPilot();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "intervencion";

  const exceptions = pilot.exceptions.filter((x) => tab === "resueltos" ? x.status === "resolved" : x.status === "open");
  const assignments = pilot.assignments.filter((x) => tab === "seguimiento" ? ["assigned", "accepted"].includes(x.status) : tab === "resueltos" ? ["cancelled", "expired"].includes(x.status) : false);
  const failed = tab === "intervencion" ? latestFailedNotifications(pilot.notifications) : [];

  const openExceptionCount = pilot.exceptions.filter((x) => x.status === "open").length;
  const resolvedExceptionCount = pilot.exceptions.filter((x) => x.status === "resolved").length;
  const failedNotificationCount = latestFailedNotifications(pilot.notifications).length;
  const followingAssignmentCount = pilot.assignments.filter((x) => ["assigned", "accepted"].includes(x.status)).length;
  const resolvedAssignmentCount = pilot.assignments.filter((x) => ["cancelled", "expired"].includes(x.status)).length;
  const tabs = [
    { id: "intervencion", label: "Intervención", count: openExceptionCount + failedNotificationCount },
    { id: "seguimiento", label: "En seguimiento", count: openExceptionCount + followingAssignmentCount },
    { id: "resueltos", label: "Resueltos", count: resolvedExceptionCount + resolvedAssignmentCount },
  ];

  const rows: WorkCaseRow[] = useMemo(() => {
    const list: WorkCaseRow[] = [];
    for (const item of exceptions) {
      list.push({
        id: `exception-${rowId(item.id)}`,
        tone: tab === "resueltos" ? "success" : "danger",
        title: item.summary || "Intervención requerida",
        detail: tab === "resueltos" ? "Incidencia resuelta." : "Próximo paso: revisar el contexto y resolver.",
        source: "Excepción operativa",
        timestamp: item.created_at,
      });
    }
    for (const item of failed) {
      list.push({
        id: `notification-${rowId(item.id)}`,
        tone: "danger",
        title: "Notificación no entregada",
        detail: "Próximo paso: revisar el contacto y reenviar.",
        source: "Notificación",
        timestamp: item.created_at,
      });
    }
    for (const item of assignments) {
      const request = pilot.requests.find((x) => x.id === item.request_id);
      const partner = pilot.partners.find((x) => x.id === item.partner_id);
      list.push({
        id: `assignment-${rowId(item.id)}`,
        tone: tab === "resueltos" ? "success" : "warning",
        title: serviceLabel(request?.service_id),
        detail: item.status === "accepted" ? "Aliado aceptó. Próximo paso: contactar al cliente." : tab === "resueltos" ? "Proceso concluido." : "Esperando respuesta del aliado.",
        source: partnerName(partner),
        timestamp: item.assigned_at,
      });
    }
    return list.sort((a, b) => +new Date(String(b.timestamp ?? 0)) - +new Date(String(a.timestamp ?? 0)));
  }, [exceptions, failed, assignments, pilot.requests, pilot.partners, tab]);

  const failure = pilot.operationalAccessError || pilot.error;

  return (
    <div className="hub-page">
      <PageHeader
        eyebrow="Operación"
        title="Trabajo"
        subtitle="Intervención, seguimiento automático y resueltos."
        meta={!pilot.loading && !failure ? <span className="hub-page-count">{rows.length} {rows.length === 1 ? "caso" : "casos"}</span> : null}
      />
      <FilterTabs tabs={tabs} activeId={tab} onChange={(id) => setParams(id === "intervencion" ? {} : { tab: id })} />
      {pilot.loading ? (
        <SkeletonRows count={5} />
      ) : failure ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar la operación" description={failure} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={tab === "resueltos" ? "Todavía no hay casos resueltos" : "Todo al día"}
          description={
            tab === "intervencion"
              ? "No hay excepciones abiertas ni notificaciones fallidas en este momento."
              : tab === "seguimiento"
              ? "No hay asignaciones activas de aliados en este momento."
              : "Los casos resueltos aparecerán aquí."
          }
        />
      ) : (
        <Table ariaLabel="Cola de trabajo">
          <TableHead columns={["Caso", "Detalle", "Origen", "Actualizado"]} />
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell variant="primary">
                <StatusBadge tone={row.tone} label={workToneLabel(row.tone)} />
                <strong>{row.title}</strong>
              </TableCell>
              <TableCell label="Detalle"><span className="hub-table-detail">{row.detail}</span></TableCell>
              <TableCell variant="muted" label="Origen">{row.source}</TableCell>
              <TableCell variant="time" label="Actualizado">{formatDate(row.timestamp)}</TableCell>
            </TableRow>
          ))}
        </Table>
      )}
    </div>
  );
}

const ORDER_STATUS_TONE: Record<string, StatusTone> = { delivered: "success", completed: "success", cancelled: "danger", pending: "warning" };
export function OrdersScreen() {
  const data = useReferralOrders();
  return (
    <div className="hub-page">
      <PageHeader eyebrow="Operación" title="Pedidos" subtitle="Pedidos activos y completados" meta={!data.loading && !data.error ? <span className="hub-page-count">{data.orders.length} {data.orders.length === 1 ? "pedido" : "pedidos"}</span> : null} />
      {data.loading ? (
        <SkeletonRows count={5} />
      ) : data.error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los pedidos" description={data.error} />
      ) : data.orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No hay pedidos" />
      ) : (
        <div className="hub-list">
          {data.orders.map((order) => (
            <Link key={order.id} className="hub-list-row" to={`/orders/${order.id}`}>
              <Avatar name={order.customer_name} seed={order.id} />
              <div><strong>{order.customer_name}</strong><small>{order.basket_name_snapshot} · {order.partner_location_name_snapshot}</small></div>
              <StatusBadge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"} label={REFERRAL_ORDER_STATUS_LABELS[order.status]} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
export function OrderDetailScreen() {
  const { orderId = "" } = useParams();
  const data = useReferralOrders();
  const order = data.orders.find((x) => x.id === orderId);
  if (data.loading) return <div className="hub-page"><Link className="hub-back" to="/orders"><ArrowLeft />Volver</Link><EmptyState icon={ShoppingBag} title="Cargando pedido…" /></div>;
  if (data.error) return <div className="hub-page"><Link className="hub-back" to="/orders"><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar el pedido" description={data.error} /></div>;
  if (!order) return <div className="hub-page"><Link className="hub-back" to="/orders"><ArrowLeft />Volver</Link><EmptyState icon={ShoppingBag} title="Pedido no encontrado" /></div>;
  const next = REFERRAL_ORDER_NEXT_STATUSES[order.status] ?? [];
  return (
    <div className="hub-page">
      <Link className="hub-back" to="/orders"><ArrowLeft />Volver</Link>
      <PageHeader eyebrow="Pedido" title={order.customer_name} subtitle={`${order.order_code} · ${REFERRAL_ORDER_STATUS_LABELS[order.status]}`} />
      <dl className="hub-facts">
        <div><dt>Canasta</dt><dd>{order.basket_name_snapshot}</dd></div>
        <div><dt>Supermercado</dt><dd>{order.partner_name_snapshot} · {order.partner_location_name_snapshot}</dd></div>
        <div><dt>Entrega</dt><dd>{order.delivery_address}, {order.delivery_city} {order.delivery_postal_code}</dd></div>
        <div><dt>Total</dt><dd>{new Intl.NumberFormat("es-US", { style: "currency", currency: order.currency }).format(order.total_cents / 100)}</dd></div>
      </dl>
      {data.actionError ? <EmptyState tone="error" icon={AlertTriangle} title="No se pudo actualizar" description={data.actionError} /> : null}
      {next.length ? (
        <div className="hub-campaign-actions">
          {next.map((status) => (
            <button key={status} type="button" className="hub-chip-btn is-primary" disabled={data.updatingOrderId === order.id} onClick={() => void data.updateStatus(order.id, status as ReferralOrderStatus)}>
              {data.updatingOrderId === order.id ? "Guardando…" : REFERRAL_ORDER_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={CheckCircle2} title="Sin más cambios disponibles" description="Este pedido no tiene más cambios de estado disponibles." />
      )}
    </div>
  );
}

export function StoresScreen() {
  const data = useOperationalPilot();
  const stores = groceryLocations(data.partners, data.locations, data.rules, data.offers);
  const failed = ["partners", "rules", "locations", "offers"].some((key) => data.queryErrors[key]);
  return (
    <div className="hub-page">
      <PageHeader eyebrow="Negocios" title="Supermercados" subtitle="Ubicaciones reales" />
      {data.loading ? (
        <SkeletonRows count={4} />
      ) : failed ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los supermercados" />
      ) : stores.length === 0 ? (
        <EmptyState icon={Store} title="No hay ubicaciones de supermercado configuradas" />
      ) : (
        <div className="hub-list">
          {stores.map((store) => (
            <Link key={rowId(store.id)} className="hub-list-row" to={`/network/stores/${rowId(store.id)}`}>
              <Avatar name={rowText(store.name, "Supermercado")} seed={rowId(store.id)} />
              <div><strong>{rowText(store.name, "Supermercado")}</strong><small>{rowText(store.formatted_address) || [store.city, store.state].map((value) => rowText(value)).filter(Boolean).join(", ")}</small></div>
              <StatusBadge tone="neutral" label={store.delivery_enabled ? "Entrega" : "Recogida"} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
