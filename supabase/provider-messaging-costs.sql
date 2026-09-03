-- provider_messaging_costs
--
-- VERIFIED provider (Meta / SMS / email) per-message cost, entered and versioned
-- from the QR Schedule Admin Panel's "Messaging Costs" page. Used ONLY for the
-- cost/profit analytics view - it never feeds message charging, wallets, Stripe,
-- or customer pricing (that stays in platform_settings).
--
-- Meta exposes no machine-readable current WhatsApp rate through a supported
-- API, so rows are `source_type = 'manual'`: an admin copies the rate from
-- Meta's official pricing page and records the URL. A future `source_type =
-- 'live'` fetch can slot in without a schema change.
--
-- History: multiple rows per (provider, channel, country, category). The rate
-- effective on date D is the `status = 'active'` row with the greatest
-- effective_from <= D, whose effective_to is null or > D.
--
-- RLS enabled with no policy => only the service-role key (the admin panel
-- server) can read or write. Safe to run more than once.

create table if not exists provider_messaging_costs (
  id text primary key,
  provider text not null default 'meta',
  channel text not null default 'whatsapp',
  country text not null default 'PK',            -- ISO-3166 alpha-2, uppercase
  category text not null default 'marketing',    -- marketing | utility | authentication | service
  currency text not null default 'PKR',          -- ISO-4217, uppercase
  cost_per_message_minor integer not null default 0 check (cost_per_message_minor >= 0),
  source_type text not null default 'manual',    -- manual | live
  source_url text not null default '',
  effective_from date not null,
  effective_to date,                             -- null = still effective
  status text not null default 'active',         -- active | inactive
  notes text not null default '',
  fetched_at timestamptz,                        -- set only for a genuine 'live' fetch
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create index if not exists provider_messaging_costs_lookup_idx
  on provider_messaging_costs (provider, channel, country, category, effective_from desc);

create index if not exists provider_messaging_costs_status_idx
  on provider_messaging_costs (status);

alter table provider_messaging_costs enable row level security;
