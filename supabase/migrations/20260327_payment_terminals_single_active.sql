begin;

with ranked as (
  select
    id,
    row_number() over (
      order by
        case when is_active then 0 else 1 end,
        updated_at desc,
        created_at desc
    ) as rank_order
  from public.payment_terminals
)
update public.payment_terminals as terminals
set is_active = ranked.rank_order = 1 and terminals.is_active
from ranked
where ranked.id = terminals.id
  and terminals.is_active = true;

create unique index if not exists idx_payment_terminals_single_active
  on public.payment_terminals ((1))
  where is_active = true;

commit;
