begin;

create extension if not exists pgcrypto;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line_1 text not null default '',
  address_line_2 text,
  town_city text not null default '',
  postcode text not null default '',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_locations_name_unique
  on public.locations (lower(name));

create index if not exists idx_locations_active
  on public.locations (active);

alter table if exists public.services
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table if exists public.services
  add column if not exists accept_public_orders boolean not null default true;

alter table if exists public.services
  add column if not exists public_order_closure_reason text;

insert into public.locations (name, address_line_1, town_city, postcode, active)
select distinct
  trim(location_name),
  '',
  '',
  '',
  true
from public.services
where location_name is not null
  and trim(location_name) <> ''
  and not exists (
    select 1
    from public.locations l
    where lower(l.name) = lower(trim(public.services.location_name))
  );

update public.services s
set location_id = l.id
from public.locations l
where s.location_id is null
  and s.location_name is not null
  and trim(s.location_name) <> ''
  and lower(l.name) = lower(trim(s.location_name));

create index if not exists idx_services_location_id
  on public.services (location_id);

commit;
