begin;

alter table if exists public.menu_item_recipes
  add column if not exists affects_availability boolean not null default true;

commit;
