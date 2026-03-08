export type VerticalProfile = {
  name: string;
  focus: string;
  pain: string;
  trialFrame: string;
  offer: string;
};

const VERTICALS: Record<string, VerticalProfile> = {
  dental: {
    name: "Clínica dental",
    focus: "pacientes",
    pain: "los pacientes y mensajes se pierden entre agendas y recordatorios manuales",
    trialFrame: "probar la automatización con tus mensajes y citas",
    offer: "responder pacientes en minutos y coordinar citas sin depender del teléfono",
  },
  real_estate: {
    name: "Inmobiliaria",
    focus: "clientes y propiedades",
    pain: "las consultas de propiedades llegan por WhatsApp y no se siguen bien",
    trialFrame: "organizar consultas y reencuentros con interesados",
    offer: "mantener seguimiento comercial y coordinar visitas sin olvidar a nadie",
  },
  auto: {
    name: "Concesionario",
    focus: "leads de vehículos",
    pain: "los interesados por autos se enfrían antes de que los contacte el equipo",
    trialFrame: "agendar recordatorios y responder preguntas rápidas",
    offer: "sostener la atención inicial y retomar conversaciones incluso cuando el equipo está ocupado",
  },
  beauty: {
    name: "Salón de belleza",
    focus: "clientes y turnos",
    pain: "las citas se cancelan porque nadie responde o confunden horarios",
    trialFrame: "mantener avisos y recordatorios sin escribir a mano",
    offer: "coordinar turnos rápidamente y enviar recordatorios automáticos",
  },
};

const DEFAULT: VerticalProfile = {
  name: "negocio",
  focus: "clientes",
  pain: "los mensajes se pierden o quedan desorganizados",
  trialFrame: "probar la automatización con tu equipo",
  offer: "mantener cada conversación activa y organizada",
};

export function resolveVertical(alias?: string): VerticalProfile {
  if (!alias) return DEFAULT;
  const normalized = alias.trim().toLowerCase();
  if (VERTICALS[normalized]) return VERTICALS[normalized];
  return DEFAULT;
}
