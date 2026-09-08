import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { type PeriodId, periodRange } from "./period";
import { type MercaditoOrderRow } from "./mercaditoOrders";

type RawMercaditoOrder = {
  id: string; order_number: string; customer_name: string; product_name: string;
  business_name: string; zip: string; total_cents: number; currency: string;
  status: string; created_at: string;
};

export function useMercaditoOrders(period: PeriodId) {
  const { resolvedOrgId } = useReferralOrganization();
  const [rows, setRows] = useState<MercaditoOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(() => periodRange(period), [period]);

  const load = useCallback(async () => {
    if (!resolvedOrgId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError("");
    const result = await supabase
      .from("mercadito_orders")
      .select("id,order_number,customer_name,product_name,business_name,zip,total_cents,currency,status,created_at")
      .eq("organization_id", resolvedOrgId)
      .gte("created_at", range.start.toISOString())
      .lte("created_at", range.end.toISOString())
      .order("created_at", { ascending: false });
    if (result.error) {
      setRows([]); setError("No se pudieron cargar los pedidos de Mercadito."); setLoading(false); return;
    }
    setRows(((result.data ?? []) as unknown as RawMercaditoOrder[]).map((row) => ({
      id: row.id, orderNumber: row.order_number, customerName: row.customer_name,
      productName: row.product_name, businessName: row.business_name, zip: row.zip,
      totalCents: row.total_cents, currency: row.currency, status: row.status, createdAt: row.created_at,
    })));
    setLoading(false);
  }, [range.end, range.start, resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, load };
}
