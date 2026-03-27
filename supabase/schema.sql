create extension if not exists pgcrypto;

create table if not exists locations (
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
  on locations (lower(name));

create index if not exists idx_locations_active
  on locations (active);

create table if not exists services (
  id text primary key,
  name text not null,
  service_date date not null,
  location_name text,
  location_id uuid references locations(id) on delete set null,
  status text not null default 'draft',
  accept_public_orders boolean not null default true,
  public_order_closure_reason text,
  start_time time not null,
  end_time time not null,
  last_collection_time time not null,
  slot_size_minutes integer not null default 5,
  pizzas_per_slot integer not null default 3,
  delay_minutes integer not null default 0,
  paused_until timestamptz,
  pause_reason text
);

create index if not exists idx_services_location_id
  on services (location_id);

create table if not exists ingredients (
  id text primary key,
  name text not null,
  unit text not null,
  low_stock_threshold numeric not null default 0,
  default_stock_amount numeric not null default 0,
  active boolean not null default true
);

create table if not exists menu_items (
  id text primary key,
  name text not null,
  category text,
  category_slug text,
  sort_order integer not null default 0,
  chilli_rating integer not null default 0 check (chilli_rating in (0, 1, 2, 3)),
  image_url text,
  price numeric not null,
  active boolean not null default true,
  loyverse_item_id text,
  description text
);

create index if not exists idx_menu_items_category_slug
  on menu_items (category_slug);

create index if not exists idx_menu_items_sort_order
  on menu_items (category_slug, sort_order);

create table if not exists menu_item_recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id text references menu_items(id),
  ingredient_id text references ingredients(id),
  quantity numeric not null,
  affects_availability boolean not null default true
);

create unique index if not exists idx_menu_item_recipes_menu_item_ingredient
  on menu_item_recipes (menu_item_id, ingredient_id);

create index if not exists idx_menu_item_recipes_menu_item_id
  on menu_item_recipes (menu_item_id);

create index if not exists idx_menu_item_recipes_ingredient_id
  on menu_item_recipes (ingredient_id);

create table if not exists modifiers (
  id text primary key,
  name text not null,
  price_delta numeric not null default 0,
  stock_ingredient_id text references ingredients(id),
  stock_quantity numeric not null default 0,
  max_per_pizza integer not null default 1,
  applies_to_all_pizzas boolean not null default true
);

create table if not exists menu_item_modifiers (
  menu_item_id text references menu_items(id),
  modifier_id text references modifiers(id),
  primary key (menu_item_id, modifier_id)
);

create index if not exists idx_menu_item_modifiers_modifier_id
  on menu_item_modifiers (modifier_id);

create table if not exists discount_codes (
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
  applies_to_menu_item_id text references menu_items(id),
  applies_to_category_slug text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists service_inventory (
  id uuid not null default gen_random_uuid() unique,
  service_id text references services(id),
  ingredient_id text references ingredients(id),
  quantity numeric not null default 0,
  starting_quantity numeric not null default 0,
  reserved_quantity numeric not null default 0,
  used_quantity numeric not null default 0,
  primary key (service_id, ingredient_id)
);

create table if not exists customers (
  id text primary key,
  name text not null,
  mobile text,
  email text,
  auth_user_id text
);

create index if not exists idx_customers_email
  on customers (lower(email));

create table if not exists orders (
  id text primary key,
  service_id text references services(id),
  customer_id text references customers(id),
  reference text not null,
  source text not null,
  status text not null check (status in ('taken', 'prepping', 'in_oven', 'ready', 'completed')),
  promised_time timestamptz not null,
  customer_name text,
  customer_mobile text,
  customer_email text,
  auth_user_id text,
  pizza_count integer not null default 0,
  subtotal_amount numeric not null default 0,
  total_discount_amount numeric not null default 0,
  order_discount_amount numeric not null default 0,
  total_amount numeric not null default 0,
  applied_discount_code_id uuid references discount_codes(id) on delete set null,
  applied_discount_summary jsonb,
  pricing_summary jsonb,
  pager_number integer,
  payment_status text not null,
  payment_method text not null,
  payment_reference text,
  receipt_email_status text not null default 'not_requested',
  receipt_sent_at timestamptz,
  receipt_last_error text,
  loyverse_sync_status text not null,
  notes text,
  created_at timestamptz not null default now(),
  taken_at timestamptz not null,
  prepping_at timestamptz,
  in_oven_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_orders_customer_email
  on orders (lower(customer_email));

create index if not exists idx_orders_auth_user_id
  on orders (auth_user_id);

create table if not exists order_items (
  id text primary key,
  order_id text references orders(id) on delete cascade,
  menu_item_id text references menu_items(id),
  quantity integer not null,
  original_unit_price numeric,
  item_discount_amount numeric not null default 0,
  final_unit_price numeric,
  applied_discount_summary jsonb,
  progress_count integer not null default 0,
  notes text
);

create table if not exists order_item_modifiers (
  id bigint generated always as identity primary key,
  order_item_id text references order_items(id) on delete cascade,
  modifier_id text references modifiers(id),
  modifier_name text not null,
  price_delta numeric not null default 0,
  quantity integer not null default 1
);

create table if not exists discount_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references discount_codes(id) on delete cascade,
  order_id text not null references orders(id) on delete cascade,
  order_item_id text references order_items(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  redeemed_by_user_id text,
  code_snapshot text not null,
  discount_type_snapshot text not null,
  discount_value_snapshot numeric not null,
  applied_discount_amount numeric not null default 0
);

create table if not exists service_slots (
  service_id text references services(id),
  slot_time timestamptz not null,
  allocated_pizzas integer not null default 0,
  capacity integer not null default 3,
  primary key (service_id, slot_time)
);

create table if not exists order_status_history (
  id text primary key,
  order_id text references orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now(),
  changed_by text not null,
  note text
);

create table if not exists loyverse_sync_queue (
  id text primary key,
  order_id text references orders(id) on delete cascade,
  status text not null,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  receipt_id text,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists payments (
  id text primary key,
  order_id text references orders(id) on delete cascade,
  provider text not null,
  method text not null,
  status text not null,
  amount numeric not null,
  provider_reference text not null,
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_terminals (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  reader_id text not null,
  reader_name text not null,
  location_id uuid references locations(id) on delete set null,
  is_active boolean not null default true,
  provider_status text not null default 'paired',
  paired_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_payment_terminals_reader_id_unique
  on payment_terminals (reader_id);

create index if not exists idx_payment_terminals_location_active
  on payment_terminals (location_id, is_active);

create index if not exists idx_payment_terminals_provider
  on payment_terminals (provider);

create unique index if not exists idx_payment_terminals_single_active
  on payment_terminals ((1))
  where is_active = true;

create table if not exists activity_log (
  id text primary key,
  type text not null,
  actor text not null,
  order_id text references orders(id),
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists service_runtime_state (
  service_id text primary key references services(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
