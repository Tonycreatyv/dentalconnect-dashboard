export type BarberDemoAppointment = {
  id: string;
  lead_id: string | null;
  organization_id: string;
  patient_name: string;
  reason: string;
  title: string;
  appointment_date: string;
  appointment_time: string;
  starts_at: string;
  start_at: string;
  ends_at: string;
  provider_id: string;
  provider_name: string;
  status: "confirmed" | "pending";
  channel: "whatsapp";
  created_at: string;
  updated_at: string;
};

export type BarberDemoLead = {
  id: string;
  organization_id: string;
  channel_user_id: string;
  avatar_url: string | null;
  state: Record<string, unknown>;
  full_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  status: string;
  channel: string;
  last_channel: string;
  last_bot_reply_at: string;
  last_message_at: string;
  last_message_preview: string;
  handoff_to_human: boolean;
  latest_message_content: string;
  latest_message_at: string;
};

export type BarberDemoMessage = {
  id: string;
  organization_id: string;
  lead_id: string;
  channel: string;
  channel_user_id: string;
  provider_message_id: string;
  actor: string;
  role: string;
  content: string;
  created_at: string;
  interactive_options?: string[];
};

export type BarberLoginPreview = {
  title: string;
  stats: Array<{ label: string; value: string }>;
  chat: Array<{ speaker: "customer" | "barberline"; text: string }>;
  upcoming: Array<{ time: string; customer: string; service: string; status: string }>;
};

export const BARBER_DEMO_ORG_ID = "barber-demo";
export const BARBER_DEMO_LEAD_ID = "barber-demo-luis-mejia";
export const BARBER_DEMO_CHANNEL_USER_ID = "whatsapp:+50498764321";

function dayKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(12, 0, 0, 0);
  return value.toISOString().slice(0, 10);
}

function at(dateKey: string, hour: number, minute: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function appointmentTime(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" }).replace("a. m.", "AM").replace("p. m.", "PM");
}

export function buildBarberDemoAppointments(date = new Date()): BarberDemoAppointment[] {
  const dateKey = dayKey(date);
  const now = new Date().toISOString();
  return [
    {
      id: "barber-demo-appt-juan-0900",
      lead_id: "barber-demo-juan-perez",
      organization_id: BARBER_DEMO_ORG_ID,
      patient_name: "Juan Pérez",
      reason: "Corte + barba",
      title: "Corte + barba",
      appointment_date: dateKey,
      appointment_time: appointmentTime(9, 0),
      starts_at: at(dateKey, 9, 0),
      start_at: at(dateKey, 9, 0),
      ends_at: at(dateKey, 9, 45),
      provider_id: "barber-demo-carlos",
      provider_name: "Carlos",
      status: "confirmed",
      channel: "whatsapp",
      created_at: now,
      updated_at: now,
    },
    {
      id: "barber-demo-appt-luis-1030",
      lead_id: BARBER_DEMO_LEAD_ID,
      organization_id: BARBER_DEMO_ORG_ID,
      patient_name: "Luis Mejía",
      reason: "Corte clásico",
      title: "Corte clásico",
      appointment_date: dateKey,
      appointment_time: appointmentTime(10, 30),
      starts_at: at(dateKey, 10, 30),
      start_at: at(dateKey, 10, 30),
      ends_at: at(dateKey, 11, 0),
      provider_id: "barber-demo-william",
      provider_name: "William",
      status: "confirmed",
      channel: "whatsapp",
      created_at: now,
      updated_at: now,
    },
    {
      id: "barber-demo-appt-andres-1200",
      lead_id: "barber-demo-andres-castro",
      organization_id: BARBER_DEMO_ORG_ID,
      patient_name: "Andrés Castro",
      reason: "Barba",
      title: "Barba",
      appointment_date: dateKey,
      appointment_time: appointmentTime(12, 0),
      starts_at: at(dateKey, 12, 0),
      start_at: at(dateKey, 12, 0),
      ends_at: at(dateKey, 12, 30),
      provider_id: "barber-demo-carlos",
      provider_name: "Carlos",
      status: "confirmed",
      channel: "whatsapp",
      created_at: now,
      updated_at: now,
    },
    {
      id: "barber-demo-appt-marco-1400",
      lead_id: "barber-demo-marco-rodriguez",
      organization_id: BARBER_DEMO_ORG_ID,
      patient_name: "Marco Rodríguez",
      reason: "Corte clásico",
      title: "Corte clásico",
      appointment_date: dateKey,
      appointment_time: appointmentTime(14, 0),
      starts_at: at(dateKey, 14, 0),
      start_at: at(dateKey, 14, 0),
      ends_at: at(dateKey, 14, 30),
      provider_id: "barber-demo-william",
      provider_name: "William",
      status: "pending",
      channel: "whatsapp",
      created_at: now,
      updated_at: now,
    },
  ];
}

export function buildBarberDemoLeads(): BarberDemoLead[] {
  const now = new Date().toISOString();
  return [
    {
      id: BARBER_DEMO_LEAD_ID,
      organization_id: BARBER_DEMO_ORG_ID,
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      avatar_url: null,
      state: { conversation_mode: "bot_active" },
      full_name: "Luis Mejía",
      first_name: "Luis",
      last_name: "Mejía",
      phone: "+504 9876-4321",
      status: "open",
      channel: "whatsapp",
      last_channel: "whatsapp",
      last_bot_reply_at: now,
      last_message_at: now,
      last_message_preview: "Listo, tu cita quedó confirmada para hoy a las 10:30 AM con William.",
      handoff_to_human: false,
      latest_message_content: "Listo, tu cita quedó confirmada para hoy a las 10:30 AM con William.",
      latest_message_at: now,
    },
  ];
}

export function buildBarberDemoThread(): BarberDemoMessage[] {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(Math.max(0, date.getMinutes() - 7));
  const nextTime = () => {
    const value = date.toISOString();
    date.setMinutes(date.getMinutes() + 1);
    return value;
  };

  return [
    {
      id: "barber-demo-msg-1",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-1",
      actor: "user",
      role: "user",
      content: "Hola, ¿tenés espacio hoy?",
      created_at: nextTime(),
    },
    {
      id: "barber-demo-msg-2",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-2",
      actor: "bot",
      role: "assistant",
      content: "Sí, tengo estos horarios disponibles para hoy.",
      created_at: nextTime(),
      interactive_options: ["9:00 AM", "10:30 AM", "2:00 PM"],
    },
    {
      id: "barber-demo-msg-3",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-3",
      actor: "user",
      role: "user",
      content: "10:30 AM",
      created_at: nextTime(),
    },
    {
      id: "barber-demo-msg-4",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-4",
      actor: "bot",
      role: "assistant",
      content: "Perfecto. ¿Qué servicio querés?",
      created_at: nextTime(),
      interactive_options: ["Corte clásico", "Corte + barba", "Barba"],
    },
    {
      id: "barber-demo-msg-5",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-5",
      actor: "user",
      role: "user",
      content: "Corte clásico",
      created_at: nextTime(),
    },
    {
      id: "barber-demo-msg-6",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-6",
      actor: "bot",
      role: "assistant",
      content: "Perfecto. Tengo a William disponible a las 10:30 AM. ¿Confirmamos?",
      created_at: nextTime(),
      interactive_options: ["Confirmar", "Cambiar hora", "Hablar con alguien"],
    },
    {
      id: "barber-demo-msg-7",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-7",
      actor: "user",
      role: "user",
      content: "Confirmar",
      created_at: nextTime(),
    },
    {
      id: "barber-demo-msg-8",
      organization_id: BARBER_DEMO_ORG_ID,
      lead_id: BARBER_DEMO_LEAD_ID,
      channel: "whatsapp",
      channel_user_id: BARBER_DEMO_CHANNEL_USER_ID,
      provider_message_id: "demo-wa-8",
      actor: "bot",
      role: "assistant",
      content: "Listo, tu cita quedó confirmada para hoy a las 10:30 AM con William.",
      created_at: nextTime(),
    },
  ];
}

export function buildBarberLoginPreview(): BarberLoginPreview {
  return {
    title: "Tu barbería, organizada",
    stats: [
      { label: "Citas hoy", value: "5" },
      { label: "Mensajes", value: "2" },
    ],
    chat: [
      { speaker: "customer", text: "Hola, ¿tenés espacio hoy?" },
      { speaker: "barberline", text: "Sí, tengo 9:00 AM, 10:30 AM y 2:00 PM." },
      { speaker: "customer", text: "10:30 AM" },
      { speaker: "barberline", text: "Listo, cita confirmada para hoy a las 10:30 AM." },
    ],
    upcoming: [
      { time: "9:00 AM", customer: "Juan Pérez", service: "Corte + barba", status: "Ahora" },
      { time: "10:30 AM", customer: "Luis Mejía", service: "Corte clásico", status: "Confirmada" },
      { time: "12:00 PM", customer: "Andrés Castro", service: "Barba", status: "Próxima" },
    ],
  };
}
