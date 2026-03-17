begin;

alter table if exists public.ingredients
  add column if not exists low_stock_threshold numeric not null default 0;

commit;
