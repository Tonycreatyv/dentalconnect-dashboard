/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { filterMercaditoOrders, mercaditoStatusLabel, type MercaditoOrderRow } from "./mercaditoOrders.ts";

const rows: MercaditoOrderRow[] = [
  { id: "1", orderNumber: "MO-1001", customerName: "Ana", productName: "Despensa Esencial", businessName: "The Mableton Supermarket", zip: "30126", totalCents: 15000, currency: "USD", status: "NEW", createdAt: "2026-09-07T12:00:00Z" },
  { id: "2", orderNumber: "MO-1002", customerName: "Luis", productName: "Despensa Familiar", businessName: "Otro supermercado", zip: "30000", totalCents: 20000, currency: "USD", status: "COMPLETED", createdAt: "2026-09-07T13:00:00Z" },
];

Deno.test("Mercadito statuses use customer/operator Spanish labels", () => {
  assertEquals(mercaditoStatusLabel("NEW"), "Nuevo");
  assertEquals(mercaditoStatusLabel("PREPARING"), "Preparando");
  assertEquals(mercaditoStatusLabel("CANCELED"), "Cancelado");
});

Deno.test("Mercadito filters combine supermarket and status without exposing internal IDs", () => {
  assertEquals(filterMercaditoOrders(rows, "The Mableton Supermarket", "NEW").map((row) => row.orderNumber), ["MO-1001"]);
  assertEquals(filterMercaditoOrders(rows, "The Mableton Supermarket", "COMPLETED"), []);
});
