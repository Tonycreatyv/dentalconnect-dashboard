import type { ReferralOrderCoverageStatus, ReferralOrderStatus } from "./orderTypes";

export const REFERRAL_ORDER_LIST_COLUMNS = [
  "id",
  "order_code",
  "status",
  "partner_name_snapshot",
  "partner_location_name_snapshot",
  "basket_name_snapshot",
  "subtotal_cents",
  "delivery_fee_cents",
  "total_cents",
  "currency",
  "customer_name",
  "customer_phone",
  "delivery_address",
  "delivery_city",
  "delivery_state",
  "delivery_postal_code",
  "coverage_status",
  "customer_notes",
  "source_channel",
  "campaign_code",
  "created_at",
] as const;

export const REFERRAL_ORDER_LIST_SELECT = REFERRAL_ORDER_LIST_COLUMNS.join(", ");

export type ReferralOrderListItem = {
  id: string;
  order_code: string;
  status: ReferralOrderStatus;
  partner_name_snapshot: string;
  partner_location_name_snapshot: string;
  basket_name_snapshot: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  currency: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_city: string;
  delivery_state: string;
  delivery_postal_code: string;
  coverage_status: ReferralOrderCoverageStatus;
  customer_notes: string | null;
  source_channel: "web" | "whatsapp" | "voice" | "qr" | "admin";
  campaign_code: string | null;
  created_at: string;
};

export function getReferralOrderHomeMetrics(orders: ReferralOrderListItem[]) {
  return orders.reduce((metrics, order) => {
    if (order.status === "submitted") metrics.received += 1;
    if (order.status === "preparing") metrics.preparing += 1;
    if (order.status === "out_for_delivery") metrics.outForDelivery += 1;
    return metrics;
  }, { received: 0, preparing: 0, outForDelivery: 0 });
}

export const REFERRAL_ORDER_STATUS_LABELS: Record<ReferralOrderStatus, string> = {
  submitted: "Recibido",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  out_for_delivery: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export const REFERRAL_ORDER_NEXT_STATUSES: Record<ReferralOrderStatus, ReferralOrderStatus[]> = {
  submitted: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export type ReferralOrderStatusEvent = {
  id: string;
  order_id: string;
  from_status: ReferralOrderStatus | null;
  to_status: ReferralOrderStatus;
  actor_type: "customer" | "staff" | "system" | "partner" | "whatsapp";
  note: string | null;
  created_at: string;
};

export type ReferralOrdersViewState = "unconfigured" | "loading" | "error" | "empty" | "ready";

export function resolveReferralOrdersViewState({
  organizationId,
  loading,
  error,
  orderCount,
}: {
  organizationId: string | null;
  loading: boolean;
  error: string | null;
  orderCount: number;
}): ReferralOrdersViewState {
  if (!organizationId && !loading) return "unconfigured";
  if (loading) return "loading";
  if (error) return "error";
  return orderCount === 0 ? "empty" : "ready";
}

export type ReferralOrdersClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, options: { ascending: boolean }) => PromiseLike<{
          data: unknown[] | null;
          error: unknown;
        }>;
      };
    };
  };
};

export type ReferralOrderEventsClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        in: (column: string, values: string[]) => {
          order: (column: string, options: { ascending: boolean }) => PromiseLike<{
            data: unknown[] | null;
            error: unknown;
          }>;
        };
      };
    };
  };
};

export type ReferralOrderStatusClient = {
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};

export async function fetchReferralOrders(client: ReferralOrdersClient, organizationId: string) {
  if (!organizationId) return { data: [] as ReferralOrderListItem[], error: null };
  const result = await client
    .from("referral_orders")
    .select(REFERRAL_ORDER_LIST_SELECT)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  return {
    data: (result.data ?? []) as ReferralOrderListItem[],
    error: result.error,
  };
}

export async function fetchReferralOrderStatusEvents(
  client: ReferralOrderEventsClient,
  organizationId: string,
  orderIds: string[],
) {
  if (!organizationId || orderIds.length === 0) {
    return { data: [] as ReferralOrderStatusEvent[], error: null };
  }
  const result = await client.from("referral_order_status_events")
    .select("id, order_id, from_status, to_status, actor_type, note, created_at")
    .eq("organization_id", organizationId)
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });
  return {
    data: (result.data ?? []) as ReferralOrderStatusEvent[],
    error: result.error,
  };
}

export async function updateReferralOrderStatus(
  client: ReferralOrderStatusClient,
  organizationId: string,
  orderId: string,
  nextStatus: ReferralOrderStatus,
) {
  return await client.rpc("update_referral_order_status", {
    p_organization_id: organizationId,
    p_order_id: orderId,
    p_to_status: nextStatus,
    p_note: null,
  });
}
