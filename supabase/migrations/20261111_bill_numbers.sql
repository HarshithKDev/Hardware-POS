-- =====================================================================
-- Hardware-POS: sequential bill numbers (1, 2, 3 ...) for GST invoices
-- Run AFTER 20261111_atomic_actions.sql.
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again.
--
-- Existing sales are numbered once, in date order, so old and new bills form one
-- continuous series. Stock receipts, transfers and showroom dispatches are not
-- invoices and get no number. Numbers are never changed once given.
-- =====================================================================
begin;

alter table public.bills add column if not exists bill_no bigint;
alter table public.bills add column if not exists client_ref text;

-- Per-shop counter (only the database functions use it)
create table if not exists public.bill_counters (
  shop_id uuid primary key references public.shop_settings(id),
  last_no bigint not null default 0
);
alter table public.bill_counters enable row level security;

-- Number existing sales in date order (continuing after any numbers already given)
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

create unique index if not exists bills_shop_bill_no_uidx
  on public.bills (shop_id, bill_no) where bill_no is not null;

insert into public.bill_counters (shop_id, last_no)
select shop_id, max(bill_no) from public.bills where bill_no is not null group by shop_id
on conflict (shop_id) do update set last_no = greatest(public.bill_counters.last_no, excluded.last_no);

-- The one-call sale function now also gives the next bill number
create or replace function public.pos_process_sale(
  p_action text,
  p_location text,
  p_cashier_name text,
  p_items jsonb,
  p_payment_method text default null,
  p_cash_amount numeric default 0,
  p_upi_amount numeric default 0,
  p_total_amount numeric default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_screw_price numeric default null,
  p_client_ref text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := get_current_shop_id();
  v_existing uuid;
  v_result json;
  v_bill uuid;
  v_item jsonb;
  v_msp numeric;
  v_price numeric;
  v_is_showroom boolean := (p_payment_method = 'SHOWROOM');
  v_bill_no bigint;
begin
  if v_shop is null then
    raise exception 'Unable to determine shop_id. Are you logged in?';
  end if;

  -- Non-billable (helper) staff cannot bill customers
  if p_action = 'SALE' and exists (
    select 1 from public.workers where id = auth.uid() and password like '%NON_BILLABLE%'
  ) then
    raise exception 'This staff account is not allowed to bill customers.';
  end if;

  -- Same checkout sent twice (retry after a dropped connection): return the first bill
  if p_client_ref is not null then
    perform pg_advisory_xact_lock(hashtext(v_shop::text || ':' || p_client_ref));
    select id, bill_no into v_existing, v_bill_no from public.bills where shop_id = v_shop and client_ref = p_client_ref limit 1;
    if v_existing is not null then
      return json_build_object('success', true, 'bill_id', v_existing, 'bill_no', v_bill_no, 'duplicate', true);
    end if;
  end if;

  -- Never sell below the batch MSP (showroom dispatch is not a sale)
  if p_action = 'SALE' and not v_is_showroom then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_msp := null;
      select msp into v_msp from public.inventory_batches
       where shop_id = v_shop and batch_id = nullif(v_item->>'batch_id', '')::uuid;
      v_price := coalesce((v_item->>'final_price')::numeric, 0);
      if coalesce(v_msp, 0) > 0 and v_price < v_msp - 0.01 then
        raise exception 'Cannot sell % below MSP (price %, MSP %).', v_item->>'name', v_price, v_msp;
      end if;
    end loop;
  end if;

  v_result := public.process_pos_transaction_unsafe(p_action, p_location, p_cashier_name, p_items);
  v_bill := (v_result->>'bill_id')::uuid;

  update public.bills set
    client_ref     = p_client_ref,
    payment_method = case when p_action = 'SALE' then p_payment_method else null end,
    cash_amount    = coalesce(p_cash_amount, 0),
    upi_amount     = coalesce(p_upi_amount, 0),
    total_amount   = case when p_action = 'SALE' and p_total_amount is not null then p_total_amount else total_amount end,
    customer_name  = coalesce(p_customer_name, customer_name),
    customer_phone = coalesce(p_customer_phone, customer_phone),
    status         = case when v_is_showroom then 'showroom_pending' else status end,
    location       = case when p_action = 'RECEIVE' and p_location = 'Store' then 'Warehouse-Inbound' else location end
  where id = v_bill and shop_id = v_shop;

  if p_action = 'SALE' and p_screw_price is not null then
    insert into public.bill_items (
      bill_id, shop_id, barcode, name, quantity, billable_quantity, actual_quantity,
      price_at_sale, system_price, profit, unit
    ) values (
      v_bill, v_shop, 'SCREWS', 'Screws', 1, 1, 1,
      p_screw_price, p_screw_price, p_screw_price, 'SET'
    );
  end if;

  -- Sequential bill number for real sales only (not receipts, transfers or showroom)
  if p_action = 'SALE' and not v_is_showroom then
    insert into public.bill_counters (shop_id, last_no) values (v_shop, 1)
      on conflict (shop_id) do update set last_no = public.bill_counters.last_no + 1
      returning last_no into v_bill_no;
    update public.bills set bill_no = v_bill_no where id = v_bill and shop_id = v_shop;
  end if;

  return json_build_object('success', true, 'bill_id', v_bill, 'bill_no', v_bill_no);
end;
$$;

grant execute on function public.pos_process_sale(text, text, text, jsonb, text, numeric, numeric, numeric, text, text, numeric, text) to authenticated;

commit;
