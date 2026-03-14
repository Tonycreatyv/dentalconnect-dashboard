-- add product knowledge base used by Creatyv Sales Agent
create table if not exists public.product_knowledge (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  content jsonb not null,
  type text not null default 'json',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists product_knowledge_topic_idx on public.product_knowledge (topic);

insert into public.product_knowledge (topic, content, type)
values
  ('implementation_steps', jsonb '[
    "Create your Creatyv account",
    "Choose your business type",
    "Enter the Creatyv dashboard",
    "Connect your Facebook page or preferred messaging channel",
    "Activate the AI receptionist assistant",
    "Configure workflows, services and calendar rules",
    "Start receiving and responding to messages automatically"
  ]', 'json'),
  ('pricing_plans', jsonb '[
    {
      "name": "Starter",
      "price": 99,
      "description": "Automate responses, capture leads and stay on top of incoming messages.",
      "recommended": false
    },
    {
      "name": "Growth",
      "price": 249,
      "description": "Automate messaging, appointments, follow-ups and surface insights in one place.",
      "recommended": true
    },
    {
      "name": "Pro",
      "price": 499,
      "description": "Full AI business OS with unlimited automations, calendars and premium support.",
      "recommended": false
    }
  ]', 'json'),
  ('dashboard_modules', jsonb '[
    "Inbox",
    "Calendar",
    "Patients",
    "Automation",
    "Analytics",
    "Settings"
  ]', 'json'),
  ('integrations', jsonb '[
    "Facebook Messenger",
    "WhatsApp",
    "Instagram",
    "Web chat",
    "Google Calendar"
  ]', 'json'),
  ('trial_flow', jsonb '[
    "Signup with Creatyv",
    "Onboarding guided by the AI assistant",
    "Connect your messaging channels and calendar",
    "Activate the AI receptionist for live traffic"
  ]', 'json');
