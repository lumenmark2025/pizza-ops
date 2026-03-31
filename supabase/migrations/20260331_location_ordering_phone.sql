alter table public.locations
  add column if not exists ordering_phone text;
