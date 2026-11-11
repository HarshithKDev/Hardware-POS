-- =====================================================================
-- Hardware-POS: retire old functions  (run this the DAY AFTER the others,
-- once every counter has reloaded the app)
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again. No business data is
-- changed except giving bill numbers to any sales saved without one.
-- =====================================================================
begin;

-- 1. Nobody can call the old sale function directly any more, so its checks
--    (billable staff, MSP, one-bill-per-checkout) can't be bypassed.
--    pos_process_sale still uses it internally (it runs as the database owner).
revoke execute on function public.process_pos_transaction_unsafe(text, text, text, jsonb) from public, anon, authenticated;

-- The old "safe" wrappers never worked (they check a workers.is_billable column
-- that does not exist) and are replaced by pos_process_sale.
drop function if exists public.process_pos_transaction(text, text, text, jsonb);
drop function if exists public.process_pos_transaction(text, text, text, text, numeric, numeric, jsonb);

-- 2. Give a bill number to any real sale saved through the old path
--    (a counter that had not reloaded yet). Continues the series; never renumbers.
with mx as (
  select s.id as shop_id, coalesce(max(b.bill_no), 0) as m
  from public.shop_settings s
  left join public.bills b on b.shop_id = s.id
  group by s.id
),
numbered as (
  select b.id,
         mx.m + row_number() over (partition by b.shop_id order by b.created_at, b.id) as n
  from public.bills b
  join mx on mx.shop_id = b.shop_id
  where b.bill_no is null
    and b.location = 'Store'
    and coalesce(b.payment_method, '') <> 'SHOWROOM'
    and coalesce(b.status, '') not in ('showroom', 'showroom_pending')
    and (coalesce(b.total_amount, 0) > 0 or exists (select 1 from public.bill_items bi where bi.bill_id = b.id))
)
update public.bills b set bill_no = numbered.n
from numbered
where b.id = numbered.id;

insert into public.bill_counters (shop_id, last_no)
select shop_id, max(bill_no) from public.bills where bill_no is not null group by shop_id
on conflict (shop_id) do update set last_no = greatest(public.bill_counters.last_no, excluded.last_no);

-- 3. Drop old functions that refer to a table that no longer exists ("inventory")
--    or are unused. Each one is only dropped if no trigger uses it; otherwise it is
--    kept and a notice is shown.
do $$
declare
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'decrement_stock',
        'handle_inventory_action',
        'process_inventory_action',
        'update_inventory_quantity_from_pieces',
        'adjust_batch_stock',
        'toggle_stock_instance'
      )
  loop
    if exists (select 1 from pg_trigger t where t.tgfoid = f.oid) then
      raise notice 'Kept % (a trigger still uses it)', f.sig;
    else
      execute 'drop function ' || f.sig;
      raise notice 'Dropped %', f.sig;
    end if;
  end loop;
end $$;

commit;
