begin;

alter table if exists public.customers
  add column if not exists email text,
  add column if not exists auth_user_id text;

create index if not exists idx_customers_email
  on public.customers (lower(email));

alter table if exists public.orders
  add column if not exists customer_name text,
  add column if not exists customer_mobile text,
  add column if not exists customer_email text,
  add column if not exists auth_user_id text,
  add column if not exists receipt_email_status text not null default 'not_requested',
  add column if not exists receipt_sent_at timestamptz,
  add column if not exists receipt_last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_receipt_email_status_check'
  ) then
    alter table public.orders
      add constraint orders_receipt_email_status_check
      check (receipt_email_status in ('not_requested', 'pending', 'sending', 'sent', 'failed'));
  end if;
end $$;

create index if not exists idx_orders_customer_email
  on public.orders (lower(customer_email));

create index if not exists idx_orders_auth_user_id
  on public.orders (auth_user_id);

commit;
