-- Marketing AI tables
create table if not exists post_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  prompt text,
  tone text,
  style_preset text,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists post_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references post_campaigns(id) on delete cascade,
  platform text,
  caption text,
  hashtags text[],
  cta text,
  image_url text,
  image_prompt text,
  scheduled_at timestamptz,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists post_comment_jobs (
  id uuid primary key default gen_random_uuid(),
  post_item_id uuid not null references post_items(id) on delete cascade,
  comment_id text,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists brand_profile (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null unique,
  tone text,
  emojis text[],
  services text[],
  city text,
  phone text,
  website text,
  auto_reply_enabled boolean not null default true,
  auto_reply_requires_review boolean not null default false,
  auto_reply_daily_limit integer not null default 30,
  style_preset text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists post_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  post_item_id uuid references post_items(id) on delete set null,
  platform text,
  platform_comment_id text,
  author_name text,
  comment_text text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists post_comments_platform_comment_id_unique
  on post_comments(platform_comment_id)
  where platform_comment_id is not null;
