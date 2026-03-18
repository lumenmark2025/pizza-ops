alter table if exists public.modifiers
  add column if not exists stock_ingredient_id uuid references public.ingredients(id) on delete set null,
  add column if not exists stock_quantity numeric not null default 0,
  add column if not exists max_per_pizza integer not null default 1,
  add column if not exists applies_to_all_pizzas boolean not null default true;

create index if not exists idx_menu_item_modifiers_modifier_id
  on public.menu_item_modifiers (modifier_id);
