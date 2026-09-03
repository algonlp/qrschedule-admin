-- WhatsApp template registry
--
-- Two separate concerns, two tables (feature spec: Meta template != QR Schedule
-- assignment):
--   whatsapp_template_records            - what Meta/WABA knows about a template
--                                          (name, language, category, status,
--                                          body/components in `payload`).
--                                          Refreshed by "Sync from Meta" in the
--                                          Admin Panel; meta_status stays
--                                          'UNVERIFIED' until the first real sync.
--   whatsapp_template_assignment_records - how QR Schedule uses a template:
--                                          which messaging purpose it is bound
--                                          to and whether QR Schedule may send
--                                          with it. A Meta sync NEVER touches
--                                          these rows.
--
-- This is the SAME pair of tables defined in bookmysalon/supabase/schema.sql;
-- run whichever is convenient. Safe to run more than once.
--
-- After creating the tables, seed the shipped catalogue from the backend:
--   cd bookmysalon && npm run seed:whatsapp-templates
--
-- RLS is enabled with no policy, so only the service-role key (used by both
-- apps' servers) can read or write.

create table if not exists whatsapp_template_records (
  id text primary key,
  name text not null default '',
  language text not null default 'en_US',
  category text not null default '',
  meta_status text not null default 'UNVERIFIED',
  meta_template_id text,
  payload jsonb not null
);

create unique index if not exists whatsapp_template_records_name_lang_idx
  on whatsapp_template_records (name, language);

create index if not exists whatsapp_template_records_status_idx
  on whatsapp_template_records (meta_status);

create table if not exists whatsapp_template_assignment_records (
  id text primary key,
  purpose text not null default '',
  -- '*' = global (any plan); otherwise a subscription_plan_records.plan_key
  plan_key text not null default '*',
  -- '*' = not salon-specific; otherwise a businesses.id. A salon row wins over
  -- the plan / global rows for that one salon (resolver precedence:
  -- salon -> plan -> global -> shipped default).
  business_id text not null default '*',
  language text not null default 'en_US',
  template_name text not null default '',
  is_active boolean not null default true,
  priority integer not null default 0,
  created_by text,
  updated_by text,
  payload jsonb not null
);

-- Plan-aware upgrade for an existing install (safe to re-run):
alter table whatsapp_template_assignment_records add column if not exists plan_key text not null default '*';
alter table whatsapp_template_assignment_records add column if not exists priority integer not null default 0;
alter table whatsapp_template_assignment_records add column if not exists created_by text;
alter table whatsapp_template_assignment_records add column if not exists updated_by text;
drop index if exists whatsapp_template_assignment_purpose_lang_idx;

-- Salon-scoped assignment upgrade (safe to re-run):
alter table whatsapp_template_assignment_records add column if not exists business_id text not null default '*';
drop index if exists whatsapp_template_assignment_purpose_plan_lang_idx;

create unique index if not exists whatsapp_template_assignment_purpose_plan_biz_lang_idx
  on whatsapp_template_assignment_records (purpose, plan_key, business_id, language);

create index if not exists whatsapp_template_assignment_plan_idx
  on whatsapp_template_assignment_records (plan_key);

create index if not exists whatsapp_template_assignment_business_idx
  on whatsapp_template_assignment_records (business_id);

create index if not exists whatsapp_template_assignment_template_idx
  on whatsapp_template_assignment_records (template_name);

alter table whatsapp_template_records enable row level security;
alter table whatsapp_template_assignment_records enable row level security;
