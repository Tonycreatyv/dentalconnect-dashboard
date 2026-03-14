-- add clinic knowledge base for DentalConnect front desk
create table if not exists public.clinic_knowledge (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  content jsonb not null,
  type text not null default 'json',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists clinic_knowledge_topic_idx on public.clinic_knowledge (topic);

insert into public.clinic_knowledge (topic, content, type)
values
  ('services', jsonb '{
    "title": "Servicios",
    "items": [
      "Limpiezas profundas",
      "Ortodoncia invisible",
      "Implantes dentales",
      "Urgencias dentales 24/7",
      "Estética dental y blanqueamientos"
    ]
  }', 'json'),
  ('pricing', jsonb '{
    "title": "Precios básicos",
    "plans": [
      {"name": "Limpieza express", "price": "$80", "detail": "Incluye diagnóstico y pulido"},
      {"name": "Ortodoncia invisible", "price": "Desde $1,200", "detail": "Plan mensual con seguimiento digital"},
      {"name": "Implante completo", "price": "Desde $2,500", "detail": "Incluye corona y seguimiento"}
    ]
  }', 'json'),
  ('hours', jsonb '{
    "title": "Horarios",
    "schedule": {
      "Lunes-Viernes": "8:00 - 20:00",
      "Sábados": "9:00 - 14:00",
      "Domingos": "Cerrado"
    }
  }', 'json'),
  ('location', jsonb '{
    "title": "Ubicación",
    "address": "Av. Libertador 1234, CABA",
    "directions": "A 2 cuadras de Alto Palermo, con estacionamiento propio"
  }', 'json'),
  ('appointment_policy', jsonb '{
    "title": "Política de citas",
    "details": "Requerimos confirmación 24h antes. Cancelaciones sin cargo hasta 4h antes."
  }', 'json'),
  ('insurance', jsonb '{
    "title": "Seguro/Obra social",
    "covers": ["Swiss Medical", "OSDE", "Galeno", "Medicus"],
    "note": "Presentar credencial completa el día de la cita"
  }', 'json');
