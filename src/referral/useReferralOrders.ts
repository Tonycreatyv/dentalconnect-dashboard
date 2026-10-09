import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useActiveOrg } from "../hooks/useActiveOrg";
import {
  fetchReferralOrders,
  fetchReferralOrderStatusEvents,
  type ReferralOrderListItem,
  type ReferralOrderEventsClient,
  type ReferralOrdersClient,
  type ReferralOrderStatusClient,
  type ReferralOrderStatusEvent,
  updateReferralOrderStatus,
} from "./orders";
import type { ReferralOrderStatus } from "./orderTypes";

export function useReferralOrders() {
  const { resolvedOrgId, resolvedBusinessType } = useActiveOrg();
  const organizationId = resolvedBusinessType === "referral_hub" ? resolvedOrgId : null;
  const [orders, setOrders] = useState<ReferralOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsByOrder, setEventsByOrder] = useState<Record<string, ReferralOrderStatusEvent[]>>({});
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setOrders([]);
      setError(null);
      setEventsByOrder({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const result = await fetchReferralOrders(supabase as unknown as ReferralOrdersClient, organizationId);
    if (result.error) {
      console.warn("[Referral Hub] No se pudieron cargar pedidos", { organizationId });
      setOrders([]);
      setError("No pudimos cargar los pedidos. Intenta de nuevo.");
    } else {
      setOrders(result.data);
      const eventsResult = await fetchReferralOrderStatusEvents(
        supabase as unknown as ReferralOrderEventsClient,
        organizationId,
        result.data.map((order) => order.id),
      );
      if (!eventsResult.error) {
        setEventsByOrder(eventsResult.data.reduce<Record<string, ReferralOrderStatusEvent[]>>((groups, event) => {
          (groups[event.order_id] ??= []).push(event);
          return groups;
        }, {}));
      } else console.warn("[Referral Hub] No se pudo cargar el historial de pedidos", { organizationId });
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = useCallback(async (orderId: string, nextStatus: ReferralOrderStatus) => {
    if (!organizationId || updatingOrderId) return false;
    setUpdatingOrderId(orderId);
    setActionError(null);
    const result = await updateReferralOrderStatus(supabase as unknown as ReferralOrderStatusClient, organizationId, orderId, nextStatus);
    if (result.error) {
      setActionError("No pudimos actualizar el estado. Recarga e intenta nuevamente.");
      setUpdatingOrderId(null);
      return false;
    }
    await load();
    setUpdatingOrderId(null);
    return true;
  }, [load, organizationId, updatingOrderId]);

  return { organizationId, orders, eventsByOrder, loading, error, actionError, updatingOrderId, load, updateStatus };
}
