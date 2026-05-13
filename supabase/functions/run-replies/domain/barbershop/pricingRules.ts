import type { BarbershopService } from "./scenarioTypes.ts";
import { BARBERSHOP_SERVICES_CATALOG } from "./servicesCatalog.ts";

export function resolveBarbershopPrice(serviceId: string): {
  service: BarbershopService | null;
  priceText: string;
} {
  const service = BARBERSHOP_SERVICES_CATALOG.find((item) => item.id === serviceId) ?? null;
  if (!service) {
    return {
      service: null,
      priceText:
        "Ese servicio tendría que confirmarlo recepción directamente para darte el monto correcto.",
    };
  }

  if (typeof service.basePriceHnl === "number") {
    return {
      service,
      priceText: `${service.name}: desde HNL ${service.basePriceHnl}.`,
    };
  }

  return {
    service,
    priceText: `${service.name}: precio según evaluación en recepción.`,
  };
}
