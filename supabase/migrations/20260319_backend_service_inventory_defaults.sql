begin;

alter table if exists public.ingredients
  add column if not exists default_stock_amount numeric not null default 0;

alter table if exists public.service_inventory
  add column if not exists quantity numeric not null default 0;

update public.service_inventory
set quantity = coalesce(starting_quantity, quantity, 0);

update public.ingredients as ingredient
set default_stock_amount = coalesce(defaults.default_quantity, ingredient.default_stock_amount, 0)
from (
  select
    inventory.ingredient_id,
    coalesce(
      max(case when service.status = 'live' then coalesce(inventory.quantity, inventory.starting_quantity, 0) end),
      max(coalesce(inventory.quantity, inventory.starting_quantity, 0)),
      0
    ) as default_quantity
  from public.service_inventory as inventory
  left join public.services as service
    on service.id = inventory.service_id
  group by inventory.ingredient_id
) as defaults
where defaults.ingredient_id = ingredient.id;

create unique index if not exists idx_service_inventory_service_ingredient_unique
  on public.service_inventory (service_id, ingredient_id);

commit;
