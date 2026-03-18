alter table if exists public.modifiers
  add column if not exists price_delta numeric not null default 0;
