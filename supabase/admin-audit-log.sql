-- admin_audit_log
--
-- Append-only trail for actions taken from the QR Schedule Admin Panel
-- (subscription package create / update / activate / deactivate, price and
-- entitlement changes, ...). Written best-effort by the admin panel API
-- (src/lib/audit.ts) - a logging failure never blocks the underlying change.
--
-- This is the SAME table defined in bookmysalon/supabase/schema.sql; run
-- whichever is convenient. Safe to run more than once.
--
-- RLS is enabled with no policy, so only the service-role key (used by both
-- apps' servers) can read or write it.

create table if not exists admin_audit_log (
  id text primary key,
  actor text not null default '',
  action text not null default '',
  entity_type text not null default '',
  entity_id text not null default '',
  summary text not null default '',
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_entity_idx
  on admin_audit_log (entity_type, entity_id, created_at desc);

create index if not exists admin_audit_log_created_at_idx
  on admin_audit_log (created_at desc);

alter table admin_audit_log enable row level security;
