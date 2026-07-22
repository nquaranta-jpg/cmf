-- ============================================================
-- CMF Launch — schema
-- Run this in the Supabase SQL editor (same project the main
-- site's lead.mjs uses), then run launch_seed.sql for demo data.
-- All tables are prefixed launch_ so they can't collide with the
-- consumer site's existing tables (leads, agents, ...).
-- Access is exclusively through Netlify Functions using the
-- service-role key, so RLS is enabled with no policies: direct
-- anon/authenticated access is denied by default.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Client accounts (created manually or by admin — no self-signup)
-- password_hash format: scrypt$16384$<salt-hex>$<key-hex>
-- Generate one with:
--   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log('scrypt$16384$'+s+'$'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'ThePassword'
-- ------------------------------------------------------------
create table public.launch_clients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text not null default '',
  agency_name text not null default '',
  -- plan: leads_starter | leads_pro | leads_elite | ads_managed | training
  plan text not null default 'leads_starter',
  billing_status text not null default 'active',  -- placeholder until payments are wired
  monthly_ad_budget numeric(12,2),                -- ads_managed clients only
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Leads delivered to clients
-- Structured so Meta Lead Ads webhook ingestion can write here
-- later: source='meta', meta_lead_id, raw payload preserved.
-- ------------------------------------------------------------
create table public.launch_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.launch_clients (id) on delete set null,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  state text not null default '',
  lead_type text not null default 'final_expense'
    check (lead_type in ('final_expense', 'term_life', 'iul', 'mortgage_protection', 'veteran', 'annuity')),
  source text not null default 'manual'
    check (source in ('manual', 'import', 'meta')),
  meta_lead_id text,
  raw jsonb,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'appointment', 'sold', 'dead')),
  notes text not null default '',
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index launch_leads_client_idx on public.launch_leads (client_id);
create index launch_leads_status_idx on public.launch_leads (status);
create unique index launch_leads_meta_lead_idx on public.launch_leads (meta_lead_id) where meta_lead_id is not null;

-- ------------------------------------------------------------
-- Ad spend tracker (one row per client per day)
-- ------------------------------------------------------------
create table public.launch_spend_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.launch_clients (id) on delete cascade,
  entry_date date not null,
  spend numeric(12,2) not null default 0 check (spend >= 0),
  leads_count int not null default 0 check (leads_count >= 0),
  created_at timestamptz not null default now(),
  unique (client_id, entry_date)
);

create index launch_spend_client_date_idx on public.launch_spend_entries (client_id, entry_date);

-- ------------------------------------------------------------
-- Form submissions (IUL opt-in, leads inquiry, ads application,
-- Match application) + raw Meta webhook events
-- ------------------------------------------------------------
create table public.launch_submissions (
  id uuid primary key default gen_random_uuid(),
  form_type text not null
    check (form_type in ('iul_optin', 'leads_inquiry', 'ads_application', 'training_inquiry', 'match_application', 'meta_webhook_event')),
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  payload jsonb,
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create index launch_submissions_type_idx on public.launch_submissions (form_type, created_at desc);

-- ------------------------------------------------------------
-- Lock down: functions use the service role, which bypasses RLS.
-- Enabling RLS with no policies blocks anon/authenticated reads.
-- ------------------------------------------------------------
alter table public.launch_clients enable row level security;
alter table public.launch_leads enable row level security;
alter table public.launch_spend_entries enable row level security;
alter table public.launch_submissions enable row level security;
