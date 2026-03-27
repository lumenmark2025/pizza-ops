begin;

create table if not exists public.payment_terminals (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  reader_id text not null,
  reader_name text not null,
  location_id uuid references public.locations(id) on delete set null,
  is_active boolean not null default true,
  provider_status text not null default 'paired',
  paired_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_payment_terminals_reader_id_unique
  on public.payment_terminals (reader_id);

create index if not exists idx_payment_terminals_location_active
  on public.payment_terminals (location_id, is_active);

create index if not exists idx_payment_terminals_provider
  on public.payment_terminals (provider);

commit;
