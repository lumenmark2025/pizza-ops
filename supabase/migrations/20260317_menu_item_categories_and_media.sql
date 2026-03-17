begin;

alter table if exists public.menu_items
  add column if not exists category_slug text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists chilli_rating integer not null default 0,
  add column if not exists image_url text;

alter table if exists public.menu_items
  drop constraint if exists menu_items_chilli_rating_check;

alter table if exists public.menu_items
  add constraint menu_items_chilli_rating_check
  check (chilli_rating in (0, 1, 2, 3));

with normalized as (
  select
    id,
    lower(coalesce(name, '')) as lowered_name,
    regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '', 'g') as normalized_name,
    lower(coalesce(category, '')) as lowered_category,
    coalesce(is_pizza, true) as is_pizza
  from public.menu_items
)
update public.menu_items as menu_items
set category_slug = coalesce(
  nullif(trim(menu_items.category_slug), ''),
  case
    when normalized.normalized_name in (
      'margherita',
      'roastedveg',
      'pepperoni',
      'hotshotpepperoni',
      'beestingpepperoni',
      'pancetta',
      'hammushroom',
      'hampineapple',
      'pizzaspeziale',
      'chickenarrabiata',
      'chickencaramelisedonion',
      'chickenmushroom',
      'meatfeast'
    ) then 'pizza'
    when normalized.normalized_name in (
      'garlicpizza',
      'cheesygarlicpizza',
      'mushroomgarlicpizza',
      'chickenkyivpizza',
      'garlicthaipizza'
    ) then 'garlic-pizza'
    when normalized.normalized_name in (
      'pestochicken',
      'thematilda',
      'thespicywonder',
      'markshousespecial',
      'markhousepecial',
      'markshousespecialpizza'
    ) then 'house-specials'
    when normalized.lowered_name like '%dip%' or normalized.lowered_category in ('dip', 'dips') then 'dips'
    when normalized.lowered_name like '%drink%'
      or normalized.lowered_name like '%cola%'
      or normalized.lowered_name like '%coke%'
      or normalized.lowered_name like '%water%'
      or normalized.lowered_name like '%fanta%'
      or normalized.lowered_name like '%sprite%'
      or normalized.lowered_name like '%san pellegrino%'
      or normalized.lowered_category in ('drink', 'drinks') then 'drinks'
    when normalized.lowered_category in ('garlic pizza', 'garlic-pizza') then 'garlic-pizza'
    when normalized.lowered_category in ('house specials', 'house-specials', 'specials') then 'house-specials'
    when normalized.lowered_category in ('side', 'sides') then 'dips'
    when normalized.lowered_category = 'pizza' or normalized.is_pizza then 'pizza'
    else 'dips'
  end
)
from normalized
where normalized.id = menu_items.id;

with normalized as (
  select
    id,
    regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '', 'g') as normalized_name
  from public.menu_items
)
update public.menu_items as menu_items
set chilli_rating = case
  when normalized.normalized_name = 'hotshotpepperoni' then 2
  when normalized.normalized_name = 'beestingpepperoni' then 3
  when normalized.normalized_name = 'chickenarrabiata' then 2
  when normalized.normalized_name = 'garlicthaipizza' then 2
  when normalized.normalized_name = 'thematilda' then 1
  when normalized.normalized_name = 'thespicywonder' then 3
  else 0
end
from normalized
where normalized.id = menu_items.id;

with ranked as (
  select
    id,
    coalesce(
      case regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '', 'g')
        when 'margherita' then 10
        when 'roastedveg' then 20
        when 'pepperoni' then 30
        when 'hotshotpepperoni' then 40
        when 'beestingpepperoni' then 50
        when 'pancetta' then 60
        when 'hammushroom' then 70
        when 'hampineapple' then 80
        when 'pizzaspeziale' then 90
        when 'chickenarrabiata' then 100
        when 'chickencaramelisedonion' then 110
        when 'chickenmushroom' then 120
        when 'meatfeast' then 130
        when 'garlicpizza' then 10
        when 'cheesygarlicpizza' then 20
        when 'mushroomgarlicpizza' then 30
        when 'chickenkyivpizza' then 40
        when 'garlicthaipizza' then 50
        when 'pestochicken' then 10
        when 'thematilda' then 20
        when 'thespicywonder' then 30
        when 'markshousespecial' then 40
        when 'markhousepecial' then 40
        when 'markshousespecialpizza' then 40
        else null
      end,
      100 + row_number() over (
        partition by coalesce(category_slug, 'pizza')
        order by lower(coalesce(name, '')), id
      ) * 10
    ) as next_sort_order
  from public.menu_items
)
update public.menu_items as menu_items
set sort_order = ranked.next_sort_order
from ranked
where ranked.id = menu_items.id;

create index if not exists idx_menu_items_category_slug
  on public.menu_items (category_slug);

create index if not exists idx_menu_items_sort_order
  on public.menu_items (category_slug, sort_order);

commit;
