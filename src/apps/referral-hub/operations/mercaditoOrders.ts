export const MERCADITO_STATUS_LABELS: Record<string, string> = {
  NEW: "Nuevo",
  CONFIRMED: "Confirmado",
  PREPARING: "Preparando",
  READY: "Listo",
  COMPLETED: "Completado",
  CANCELED: "Cancelado",
};

export type MercaditoOrderRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  productName: string;
  businessName: string;
  zip: string;
  totalCents: number;
  currency: string;
  status: string;
  createdAt: string;
};

export function mercaditoStatusLabel(status: string) {
  return MERCADITO_STATUS_LABELS[status] ?? status;
}

export function filterMercaditoOrders(rows: MercaditoOrderRow[], supermarket: string, status: string) {
  return rows.filter((row) => (!supermarket || row.businessName === supermarket) && (!status || row.status === status));
}
