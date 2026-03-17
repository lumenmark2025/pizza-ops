begin;

create extension if not exists pgcrypto;

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  is_active boolean not null default true,
  discount_type text not null,
  discount_value numeric not null default 0,
  scope text not null default 'order',
  usage_mode text not null default 'single_use',
  max_uses integer,
  used_count integer not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  minimum_order_value numeric,
  applies_to_menu_item_id uuid references public.menu_items(id) on delete set null,
  applies_to_category_slug text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_codes_discount_type_check check (discount_type in ('percentage', 'fixed_amount')),
  constraint discount_codes_scope_check check (scope in ('order', 'item', 'both')),
  constraint discount_codes_usage_mode_check check (usage_mode in ('single_use', 'limited_use', 'unlimited')),
  constraint discount_codes_discount_value_check check (discount_value >= 0),
  constraint discount_codes_max_uses_check check (max_uses is null or max_uses >= 1),
  constraint discount_codes_used_count_check check (used_count >= 0)
);

create index if not exists idx_discount_codes_active
  on public.discount_codes (is_active);

create unique index if not exists idx_discount_codes_code_unique
  on public.discount_codes (lower(code));

create index if not exists idx_discount_codes_code
  on public.discount_codes (lower(code));

create table if not exists public.discount_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  redeemed_by_user_id text,
  code_snapshot text not null,
  discount_type_snapshot text not null,
  discount_value_snapshot numeric not null,
  applied_discount_amount numeric not null default 0,
  constraint discount_code_redemptions_discount_type_check check (discount_type_snapshot in ('percentage', 'fixed_amount')),
  constraint discount_code_redemptions_applied_amount_check check (applied_discount_amount >= 0)
);

create index if not exists idx_discount_code_redemptions_code_id
  on public.discount_code_redemptions (discount_code_id);

create index if not exists idx_discount_code_redemptions_order_id
  on public.discount_code_redemptions (order_id);

alter table if exists public.orders
  add column if not exists applied_discount_code_id uuid references public.discount_codes(id) on delete set null,
  add column if not exists applied_discount_summary jsonb,
  add column if not exists pricing_summary jsonb;

alter table if exists public.order_items
  add column if not exists original_unit_price_pence integer,
  add column if not exists item_discount_pence integer not null default 0,
  add column if not exists final_unit_price_pence integer,
  add column if not exists applied_discount_summary jsonb;

create index if not exists idx_orders_applied_discount_code_id
  on public.orders (applied_discount_code_id);

commit;
