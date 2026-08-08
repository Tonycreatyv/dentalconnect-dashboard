export const FRONT_SERVICE_LIMIT = 3;
export const GROCERY_CUSTOMER_PREVIEW = {
  entry: {
    message: "¡Hola! 👋 Llegaste al lugar correcto.\n\nPuedes recibir tu cupón de supermercado o ver nuestras canastas ya preparadas con delivery.\n\n¿Qué quieres hacer hoy?",
    actions: ["Quiero mi cupón", "Ver las canastas"],
  },
  afterCoupon: {
    message: "Ya que vas a comprar… ¿quieres ahorrarte también el viaje?\n\nTenemos canastas ya preparadas con productos seleccionados. Puedes ver qué incluye cada una, elegir la que más te convenga y coordinamos el delivery.",
    actions: ["Sí, ver las canastas", "No, ya tengo mi cupón"],
  },
} as const;

export type ReferralService = {
  id: string;
  nombre: string | null;
  menu_label: string | null;
  menu_orden: number | null;
  activo: boolean | null;
  tipo?: string | null;
  intake_objectives?: unknown;
  icono?: string | null;
};

const descriptions: Record<string, string> = {
  luis_compra_super: "Canastas preparadas, cupones y delivery.",
  luis_cupon_super: "Un cupón para tu próxima compra de supermercado.",
  luis_accidente: "Orientación rápida después de un accidente.",
  luis_inmigracion: "Conecta con orientación migratoria de confianza.",
  luis_cupon_medico: "Beneficios para tu próxima visita médica.",
  luis_cupon_dental: "Atención dental con un beneficio especial.",
  luis_eventos: "Próximos eventos y recursos para la comunidad.",
  luis_representante: "Habla con una persona de nuestro equipo.",
};

const icons: Record<string, string> = {
  luis_compra_super: "🛒",
  luis_cupon_super: "🎟️",
  luis_accidente: "🚗",
  luis_inmigracion: "🧭",
  luis_cupon_medico: "🩺",
  luis_cupon_dental: "🦷",
  luis_eventos: "✨",
  luis_representante: "💬",
};

export function orderServices(services: ReferralService[]) {
  return [...services].sort((left, right) => {
    const leftOrder = Number.isFinite(left.menu_orden) ? Number(left.menu_orden) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.menu_orden) ? Number(right.menu_orden) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || serviceTitle(left).localeCompare(serviceTitle(right));
  });
}

export function availableServices(services: ReferralService[]) {
  return orderServices(services).filter((service) => service.activo === true);
}

export function isShownFirst(service: ReferralService, services: ReferralService[]) {
  return availableServices(services).slice(0, FRONT_SERVICE_LIMIT).some(({ id }) => id === service.id);
}

export function moveService(services: ReferralService[], serviceId: string, destination: number) {
  const ordered = orderServices(services);
  const origin = ordered.findIndex(({ id }) => id === serviceId);
  if (origin < 0) return ordered;
  const [service] = ordered.splice(origin, 1);
  ordered.splice(Math.max(0, Math.min(destination, ordered.length)), 0, service);
  return ordered.map((item, index) => ({ ...item, menu_orden: index + 1 }));
}

export function serviceTitle(service: ReferralService) {
  return service.menu_label || service.nombre || "Servicio sin nombre";
}

export function serviceDescription(service: ReferralService) {
  if (descriptions[service.id]) return descriptions[service.id];
  if (service.tipo === "transfer") return "Atención personal cuando tus clientes la necesitan.";
  if (Array.isArray(service.intake_objectives) && service.intake_objectives.length) return "Guía a tus clientes paso a paso.";
  return "Una opción disponible para tus clientes.";
}

export function serviceIcon(service: ReferralService) {
  return service.icono || icons[service.id] || "✦";
}
