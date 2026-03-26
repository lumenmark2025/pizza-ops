begin;

alter table if exists public.orders
  add column if not exists payment_reference text;

commit;
