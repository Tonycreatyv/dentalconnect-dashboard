import { getBarbershopServiceById } from "./servicesCatalog.ts";

export const BARBERSHOP_SLOT_MINUTES = 15;

export function getServiceDurationMinutes(serviceId: string): number | null {
  const service = getBarbershopServiceById(serviceId);
  return service?.durationMinutes ?? null;
}

export function canFitServiceInWindow(args: {
  serviceId: string;
  windowMinutes: number;
}): boolean {
  const duration = getServiceDurationMinutes(args.serviceId);
  if (!duration) return false;
  return duration <= args.windowMinutes;
}
