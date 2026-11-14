-- =====================================================================
-- Hardware-POS: lighter Overview page
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction; safe to run again. No business data is changed.
--
-- The Overview worked out "dead stock" (items with stock but no sale in a year) by
-- downloading every bill of the past year and every line of those bills - thousands
-- of rows after a year, reloaded after every sale. This function returns just the
-- distinct products sold since a date, in one small answer.
-- =====================================================================
begin;

create or replace function public.pos_sold_since(p_since timestamptz)
returns table (barcode text, name text)
language sql
stable
security invoker          -- runs with the caller's own access rules (owner only)
set search_path = public
as $$
  select distinct
         bi.barcode,
         lower(trim(split_part(coalesce(bi.name, ''), ' (Cut from ', 1)))
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
   where b.shop_id = public.get_current_shop_id()
     and bi.shop_id = b.shop_id
     and b.created_at >= p_since
     and b.location = 'Store'
     -- same bills as the dashboard's sales figures
     and b.status <> 'voided'
     and b.status <> 'showroom_pending'
     and b.status <> 'showroom'
     and b.payment_method <> 'SHOWROOM'
$$;

revoke execute on function public.pos_sold_since(timestamptz) from public, anon;
grant execute on function public.pos_sold_since(timestamptz) to authenticated;

-- Indexes for the lookups every sales screen makes (skipped if they already exist)
create index if not exists bills_shop_created_idx on public.bills (shop_id, created_at);
create index if not exists bill_items_bill_id_idx on public.bill_items (bill_id);

commit;
