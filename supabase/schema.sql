create table if not exists services (
  id text primary key,
  name text not null,
  service_date date not null,
  start_time time not null,
  end_time time not null,
  last_collection_time time not null,
  slot_size_minutes integer not null default 5,
  pizzas_per_slot integer not null default 3,
  delay_minutes integer not null default 0,
  paused_until timestamptz,
  pause_reason text
);

create table if not exists ingredients (
  id text primary key,
  name text not null,
  unit text not null,
  low_stock_threshold numeric not null default 0
);

create table if not exists menu_items (
  id text primary key,
  name text not null,
  category text not null,
  price numeric not null,
  loyverse_item_id text,
  description text
);

create table if not exists menu_item_recipes (
  menu_item_id text references menu_items(id),
  ingredient_id text references ingredients(id),
  quantity numeric not null,
  primary key (menu_item_id, ingredient_id)
);

create table if not exists service_inventory (
  service_id text references services(id),
  ingredient_id text references ingredients(id),
  quantity numeric not null,
  primary key (service_id, ingredient_id)
);

create table if not exists customers (
  id text primary key,
  name text not null,
  mobile text
);

create table if not exists orders (
  id text primary key,
  service_id text references services(id),
  customer_id text references customers(id),
  reference text not null,
  source text not null,
  status text not null check (status in ('taken', 'prepping', 'in_oven', 'ready', 'completed')),
  promised_time timestamptz not null,
  pizza_count integer not null default 0,
  total_amount numeric not null default 0,
  payment_status text not null,
  payment_method text not null,
  loyverse_sync_status text not null,
  notes text,
  created_at timestamptz not null default now(),
  taken_at timestamptz not null,
  prepping_at timestamptz,
  in_oven_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz
);

create table if not exists order_items (
  id text primary key,
  order_id text references orders(id) on delete cascade,
  menu_item_id text references menu_items(id),
  quantity integer not null,
  notes text
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

create table if not exists activity_log (
  id text primary key,
  type text not null,
  actor text not null,
  order_id text references orders(id),
  message text not null,
  created_at timestamptz not null default now()
);
